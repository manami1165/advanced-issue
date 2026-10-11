// src/utils/report.js のテスト（純粋関数）
// 月次レポート（勤務時間・出勤日数・遅刻回数）の計算
//
// 使うカレンダー（曜日は手計算で確認済み）
//  - 2026-09: 9/1 は火曜。9/5 は土曜、9/6 は日曜
//  - 2026-10: 10/1 は木曜。10/3 は土曜、10/4 は日曜、10/5 は月曜、10/20 は火曜、10/21 は水曜
// 遅刻のルール: 日本時間で 9:00:00 より後の出勤（9:00:00 ちょうどは遅刻ではない）。平日のみ数える
const { isLateClockIn, calculateMonthlyReport } = require('../../src/utils/report');
const { calculateMonthlySummary } = require('../../src/utils/summary');

// 日本時間の時刻で打刻データを作る（clockIn / clockOut は 'HH:MM:SS'。clockOut が null なら未退勤）
function att(workDate, clockIn, clockOut) {
  return {
    work_date: workDate,
    clock_in: `${workDate}T${clockIn}+09:00`,
    clock_out: clockOut === null ? null : `${workDate}T${clockOut}+09:00`,
  };
}

const REGISTERED_LONG_AGO = '2020-01-01';

describe('isLateClockIn', () => {
  test.each([
    ['日本時間 9:00:00 ちょうどは遅刻ではない', '2026-10-05T00:00:00.000Z', false],
    ['日本時間 9:00:01 は遅刻', '2026-10-05T00:00:01.000Z', true],
    ['日本時間 9:00:00.001 は遅刻（ミリ秒でも 9:00 を過ぎたら遅刻）', '2026-10-05T00:00:00.001Z', true],
    ['日本時間 8:59:59 は遅刻ではない', '2026-10-04T23:59:59.000Z', false],
    ['日本時間 0:00（UTC では前日 15:00）は遅刻ではない', '2026-10-04T15:00:00.000Z', false],
    ['日本時間 23:59 は遅刻', '2026-10-05T14:59:00.000Z', true],
    ['日本時間 10:00 は遅刻', '2026-10-05T01:00:00.000Z', true],
    ['+09:00 付きの文字列 9:00:00 は遅刻ではない', '2026-10-05T09:00:00+09:00', false],
    ['+09:00 付きの文字列 9:00:01 は遅刻', '2026-10-05T09:00:01+09:00', true],
  ])('文字列: %s', (_label, value, expected) => {
    expect(isLateClockIn(value)).toBe(expected);
  });

  test.each([
    ['9:00:00 ちょうど', '2026-10-05T00:00:00.000Z', false],
    ['9:00:01', '2026-10-05T00:00:01.000Z', true],
    ['8:59:59', '2026-10-04T23:59:59.000Z', false],
  ])('Date オブジェクト: %s', (_label, iso, expected) => {
    // pg は TIMESTAMPTZ を Date で返す
    expect(isLateClockIn(new Date(iso))).toBe(expected);
  });

  test.each([[null], [undefined], ['invalid'], [new Date('invalid')]])(
    '不正な値（%p）は遅刻と判定しない',
    (value) => {
      expect(isLateClockIn(value)).toBe(false);
    }
  );
});

describe('calculateMonthlyReport', () => {
  test('戻り値は work_minutes / work_hours / attendance_days / late_count', () => {
    const result = calculateMonthlyReport({
      month: '2026-09',
      today: '2026-10-20',
      registrationDate: REGISTERED_LONG_AGO,
      attendances: [att('2026-09-01', '09:30:00', '18:00:00')],
    });
    expect(result).toEqual({
      work_minutes: 510,
      work_hours: 8.5,
      attendance_days: 1,
      late_count: 1,
    });
  });

  test('勤務時間・出勤日数は calculateMonthlySummary と同じ値になる', () => {
    const input = {
      month: '2026-10',
      today: '2026-10-20',
      registrationDate: '2026-10-02',
      attendances: [
        att('2026-10-01', '09:00:00', '18:00:00'), // 登録日より前
        att('2026-10-02', '09:10:00', '18:00:00'),
        att('2026-10-03', '10:00:00', '15:00:00'), // 土曜
        att('2026-10-05', '08:30:00', '17:40:59'),
        att('2026-10-20', '09:00:00', null), // 今日・未退勤
        att('2026-10-21', '09:00:00', '18:00:00'), // 明日（通常ありえない）
      ],
    };
    const report = calculateMonthlyReport(input);
    const summary = calculateMonthlySummary(input);
    expect(report.work_minutes).toBe(summary.work_minutes);
    expect(report.work_hours).toBe(summary.work_hours);
    expect(report.attendance_days).toBe(summary.attendance_days);
    // 念のため具体的な値も確認: 10/2 530 分 + 10/3 300 分 + 10/5 550 分
    expect(report.work_minutes).toBe(1380);
    expect(report.work_hours).toBe(23);
    expect(report.attendance_days).toBe(4); // 10/2, 10/3, 10/5, 10/20
  });

  describe('遅刻回数', () => {
    test('9:00:00 ちょうどは数えず、9:00:01 は数える', () => {
      const result = calculateMonthlyReport({
        month: '2026-10',
        today: '2026-10-20',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [
          att('2026-10-05', '09:00:00', '18:00:00'), // 月曜・ちょうど
          att('2026-10-06', '09:00:01', '18:00:00'), // 火曜・1 秒遅れ
          att('2026-10-07', '08:59:59', '18:00:00'), // 水曜・前
        ],
      });
      expect(result.late_count).toBe(1);
    });

    test('Date オブジェクトの打刻でも数える', () => {
      const result = calculateMonthlyReport({
        month: '2026-10',
        today: '2026-10-20',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [
          { work_date: '2026-10-05', clock_in: new Date('2026-10-05T00:00:00.000Z'), clock_out: null },
          { work_date: '2026-10-06', clock_in: new Date('2026-10-06T00:00:01.000Z'), clock_out: null },
        ],
      });
      expect(result.late_count).toBe(1);
    });

    test('土曜・日曜の遅い出勤（休日出勤）は遅刻に数えない', () => {
      const result = calculateMonthlyReport({
        month: '2026-10',
        today: '2026-10-20',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [
          att('2026-10-03', '13:00:00', '17:00:00'), // 土曜
          att('2026-10-04', '10:00:00', '12:00:00'), // 日曜
          att('2026-10-05', '09:30:00', '18:00:00'), // 月曜は数える
        ],
      });
      expect(result.late_count).toBe(1);
      // 土日の打刻も出勤日数には入る
      expect(result.attendance_days).toBe(3);
    });

    test('未退勤の打刻でも遅刻は数える', () => {
      const result = calculateMonthlyReport({
        month: '2026-10',
        today: '2026-10-20',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [att('2026-10-20', '09:15:00', null)],
      });
      expect(result.late_count).toBe(1);
      expect(result.work_minutes).toBe(0);
    });

    test('未来の月は 0', () => {
      const result = calculateMonthlyReport({
        month: '2026-11',
        today: '2026-10-20',
        registrationDate: REGISTERED_LONG_AGO,
        // 通常ありえないデータを渡しても数えない
        attendances: [att('2026-11-02', '10:00:00', '18:00:00')],
      });
      expect(result).toEqual({ work_minutes: 0, work_hours: 0, attendance_days: 0, late_count: 0 });
    });

    test('登録日より前の打刻は数えない', () => {
      const result = calculateMonthlyReport({
        month: '2026-10',
        today: '2026-10-20',
        registrationDate: '2026-10-06',
        attendances: [
          att('2026-10-05', '10:00:00', '18:00:00'), // 登録日の前日
          att('2026-10-06', '10:00:00', '18:00:00'), // 登録日当日は数える
        ],
      });
      expect(result.late_count).toBe(1);
      expect(result.attendance_days).toBe(1);
    });

    test('当月は今日まで（今日の遅刻は数え、明日以降は数えない）', () => {
      const result = calculateMonthlyReport({
        month: '2026-10',
        today: '2026-10-20',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [
          att('2026-10-20', '09:30:00', null), // 今日（火曜）
          att('2026-10-21', '09:30:00', null), // 明日（水曜）
        ],
      });
      expect(result.late_count).toBe(1);
    });

    test('過去の月は月末まで数える', () => {
      const result = calculateMonthlyReport({
        month: '2026-09',
        today: '2026-10-20',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [
          att('2026-09-01', '09:01:00', '18:00:00'), // 火曜
          att('2026-09-05', '09:30:00', '18:00:00'), // 土曜は数えない
          att('2026-09-30', '11:00:00', '18:00:00'), // 月末（水曜）
        ],
      });
      expect(result.late_count).toBe(2);
    });

    test('打刻がなければ 0', () => {
      const result = calculateMonthlyReport({
        month: '2026-09',
        today: '2026-10-20',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [],
      });
      expect(result).toEqual({ work_minutes: 0, work_hours: 0, attendance_days: 0, late_count: 0 });
    });
  });
});
