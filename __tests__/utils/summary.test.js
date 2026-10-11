// src/utils/summary.js のテスト（純粋関数）
// ルールは docs/requirements.md「当月集計」
//
// 使うカレンダー（曜日は手計算で確認済み）
//  - 2026-09: 9/1 は火曜。平日は 22 日
//  - 2026-10: 10/1 は木曜。10/14 は水曜。平日は 22 日
//  - 2024-02（うるう年）: 2/1 は木曜、29 日まで。平日は 21 日
//  - 2023-02（平年）   : 2/1 は水曜、28 日まで。平日は 20 日
const { getSummaryPeriod, calculateMonthlySummary } = require('../../src/utils/summary');

// 日本時間の時刻で打刻データを作る（clockOut が null なら未退勤）
function att(workDate, clockIn, clockOut, outDate = workDate) {
  return {
    work_date: workDate,
    clock_in: `${workDate}T${clockIn}:00+09:00`,
    clock_out: clockOut === null ? null : `${outDate}T${clockOut}:00+09:00`,
  };
}

// 登録日は特に断りがなければ十分前の日にする
const REGISTERED_LONG_AGO = '2020-01-01';

describe('getSummaryPeriod', () => {
  test('当月: 欠勤判定は前日まで、出勤・勤務時間は今日まで', () => {
    expect(
      getSummaryPeriod({ month: '2026-10', today: '2026-10-14', registrationDate: REGISTERED_LONG_AGO })
    ).toEqual({ from: '2026-10-01', judgeTo: '2026-10-13', recordTo: '2026-10-14' });
  });

  test('過去の月: 1 日〜月末', () => {
    expect(
      getSummaryPeriod({ month: '2026-09', today: '2026-10-14', registrationDate: REGISTERED_LONG_AGO })
    ).toEqual({ from: '2026-09-01', judgeTo: '2026-09-30', recordTo: '2026-09-30' });
  });

  test('未来の月: 対象日なし', () => {
    expect(
      getSummaryPeriod({ month: '2026-11', today: '2026-10-14', registrationDate: REGISTERED_LONG_AGO })
    ).toEqual({ from: '2026-11-01', judgeTo: null, recordTo: null });
  });

  test('登録日が月の途中なら登録日から', () => {
    expect(
      getSummaryPeriod({ month: '2026-09', today: '2026-10-14', registrationDate: '2026-09-15' }).from
    ).toBe('2026-09-15');
  });

  test('登録日がなければ月初から', () => {
    expect(getSummaryPeriod({ month: '2026-09', today: '2026-10-14' }).from).toBe('2026-09-01');
  });

  test('当月の 1 日: 欠勤判定の最終日は前月末（= 対象日なし）', () => {
    const period = getSummaryPeriod({
      month: '2026-10',
      today: '2026-10-01',
      registrationDate: REGISTERED_LONG_AGO,
    });
    expect(period).toEqual({ from: '2026-10-01', judgeTo: '2026-09-30', recordTo: '2026-10-01' });
  });
});

describe('calculateMonthlySummary', () => {
  describe('当月と過去月の期間の違い', () => {
    test('当月: 前日までの平日を欠勤判定し、今日は欠勤にしない', () => {
      // 10/1〜10/13 の平日: 1,2,5,6,7,8,9,12,13 = 9 日（今日 10/14 は含めない）
      const result = calculateMonthlySummary({
        month: '2026-10',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
      });
      expect(result).toEqual({
        month: '2026-10',
        period: { from: '2026-10-01', judge_to: '2026-10-13', record_to: '2026-10-14' },
        work_minutes: 0,
        work_hours: 0,
        attendance_days: 0,
        leave_days: 0,
        absence_days: 9,
      });
    });

    test('当月: 今日の出勤は出勤日数に含め、今日の退勤済みの勤務時間も含める', () => {
      const result = calculateMonthlySummary({
        month: '2026-10',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [att('2026-10-14', '09:00', '18:00')],
      });
      expect(result.attendance_days).toBe(1);
      expect(result.work_minutes).toBe(540);
      expect(result.work_hours).toBe(9);
      expect(result.absence_days).toBe(9);
    });

    test('当月: 今日まだ退勤していなければ出勤日数には入るが勤務時間は 0', () => {
      const result = calculateMonthlySummary({
        month: '2026-10',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [att('2026-10-14', '09:00', null)],
      });
      expect(result.attendance_days).toBe(1);
      expect(result.work_minutes).toBe(0);
    });

    test('当月: 今日の承認済み休暇はまだ休暇日数に数えない（前日まで）', () => {
      const result = calculateMonthlySummary({
        month: '2026-10',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
        approvedLeaveDates: ['2026-10-13', '2026-10-14'],
      });
      expect(result.leave_days).toBe(1); // 10/13 のみ
      expect(result.absence_days).toBe(8);
    });

    test('当月: 明日以降の打刻（通常ありえない）は数えない', () => {
      const result = calculateMonthlySummary({
        month: '2026-10',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [att('2026-10-15', '09:00', '18:00')],
      });
      expect(result.attendance_days).toBe(0);
      expect(result.work_minutes).toBe(0);
    });

    test('過去の月: 1 日〜月末の平日をすべて欠勤判定する', () => {
      const result = calculateMonthlySummary({
        month: '2026-09',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
      });
      expect(result.period).toEqual({
        from: '2026-09-01',
        judge_to: '2026-09-30',
        record_to: '2026-09-30',
      });
      expect(result.absence_days).toBe(22);
    });

    test('過去の月: 月末の日も欠勤判定に含む（今日が翌月 1 日でも）', () => {
      const result = calculateMonthlySummary({
        month: '2026-09',
        today: '2026-10-01',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [att('2026-09-30', '09:00', '18:00')],
      });
      expect(result.attendance_days).toBe(1);
      expect(result.absence_days).toBe(21);
    });
  });

  test('当月の 1 日: 欠勤判定する日がなく、今日の出勤だけ数える', () => {
    const result = calculateMonthlySummary({
      month: '2026-10',
      today: '2026-10-01',
      registrationDate: REGISTERED_LONG_AGO,
      attendances: [att('2026-10-01', '09:00', '12:30')],
      approvedLeaveDates: [],
    });
    expect(result).toEqual({
      month: '2026-10',
      period: { from: '2026-10-01', judge_to: null, record_to: '2026-10-01' },
      work_minutes: 210,
      work_hours: 3.5,
      attendance_days: 1,
      leave_days: 0,
      absence_days: 0,
    });
  });

  describe('登録日が月の途中', () => {
    test('登録日より前の日は欠勤にも出勤にも数えない', () => {
      // 9/15（火）〜9/30 の平日: 15-18(4), 21-25(5), 28-30(3) = 12 日
      const result = calculateMonthlySummary({
        month: '2026-09',
        today: '2026-10-14',
        registrationDate: '2026-09-15',
        attendances: [att('2026-09-10', '09:00', '18:00'), att('2026-09-15', '09:00', '18:00')],
        approvedLeaveDates: ['2026-09-11', '2026-09-16'],
      });
      expect(result.period.from).toBe('2026-09-15');
      expect(result.attendance_days).toBe(1); // 9/15 のみ
      expect(result.work_minutes).toBe(540);
      expect(result.leave_days).toBe(1); // 9/16 のみ
      expect(result.absence_days).toBe(10); // 12 - 出勤 1 - 休暇 1
    });

    test('当月の今日登録した社員は欠勤 0', () => {
      const result = calculateMonthlySummary({
        month: '2026-10',
        today: '2026-10-14',
        registrationDate: '2026-10-14',
      });
      expect(result.period).toEqual({ from: '2026-10-14', judge_to: null, record_to: '2026-10-14' });
      expect(result.absence_days).toBe(0);
    });

    test('登録日より前の月は対象日なしですべて 0', () => {
      const result = calculateMonthlySummary({
        month: '2026-09',
        today: '2026-10-14',
        registrationDate: '2026-10-05',
      });
      expect(result.period).toEqual({ from: '2026-10-05', judge_to: null, record_to: null });
      expect(result.absence_days).toBe(0);
      expect(result.attendance_days).toBe(0);
    });
  });

  test('未来の月: すべて 0（期間も null）', () => {
    const result = calculateMonthlySummary({
      month: '2026-11',
      today: '2026-10-14',
      registrationDate: REGISTERED_LONG_AGO,
      // 通常ありえないデータを渡しても数えない
      attendances: [att('2026-11-02', '09:00', '18:00')],
      approvedLeaveDates: ['2026-11-03'],
    });
    expect(result).toEqual({
      month: '2026-11',
      period: { from: '2026-11-01', judge_to: null, record_to: null },
      work_minutes: 0,
      work_hours: 0,
      attendance_days: 0,
      leave_days: 0,
      absence_days: 0,
    });
  });

  describe('うるう年の 2 月', () => {
    test('2024-02 は 29 日まで判定する（平日 21 日）', () => {
      const result = calculateMonthlySummary({
        month: '2024-02',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [att('2024-02-29', '09:00', '18:00')],
      });
      expect(result.period.judge_to).toBe('2024-02-29');
      expect(result.attendance_days).toBe(1);
      expect(result.absence_days).toBe(20); // 21 - 1
    });

    test('平年の 2023-02 は 28 日まで（平日 20 日）', () => {
      const result = calculateMonthlySummary({
        month: '2023-02',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
      });
      expect(result.period.judge_to).toBe('2023-02-28');
      expect(result.absence_days).toBe(20);
    });
  });

  describe('休暇', () => {
    test('打刻と承認済み休暇が同じ日にあれば出勤として数える（休暇には数えない）', () => {
      const result = calculateMonthlySummary({
        month: '2026-09',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [att('2026-09-01', '09:00', '18:00')],
        approvedLeaveDates: ['2026-09-01', '2026-09-02'],
      });
      expect(result.attendance_days).toBe(1);
      expect(result.leave_days).toBe(1); // 9/2 のみ
      expect(result.absence_days).toBe(20); // 22 - 出勤 1 - 休暇 1
    });

    test('承認済み休暇として渡された日だけを数える（pending / rejected は呼び出し側の SQL で除外され、渡されない）', () => {
      // ルート側は status = 'approved' の行だけを approvedLeaveDates に渡す（ルートのテストで確認）
      const result = calculateMonthlySummary({
        month: '2026-09',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
        approvedLeaveDates: ['2026-09-01'],
      });
      expect(result.leave_days).toBe(1);
      expect(result.absence_days).toBe(21);
    });

    test('土日の承認済み休暇（通常は申請できない）は休暇日数に数えない', () => {
      const result = calculateMonthlySummary({
        month: '2026-09',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
        approvedLeaveDates: ['2026-09-05', '2026-09-06'], // 土・日
      });
      expect(result.leave_days).toBe(0);
      expect(result.absence_days).toBe(22);
    });

    test('同じ日付が重複して渡されても 1 日として数える', () => {
      const result = calculateMonthlySummary({
        month: '2026-09',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
        approvedLeaveDates: ['2026-09-01', '2026-09-01'],
      });
      expect(result.leave_days).toBe(1);
    });
  });

  test('土日の打刻は出勤日数・勤務時間に入るが、土日は欠勤判定に入らない', () => {
    const result = calculateMonthlySummary({
      month: '2026-09',
      today: '2026-10-14',
      registrationDate: REGISTERED_LONG_AGO,
      attendances: [att('2026-09-05', '10:00', '15:00'), att('2026-09-06', '10:00', '12:00')],
    });
    expect(result.attendance_days).toBe(2);
    expect(result.work_minutes).toBe(420);
    expect(result.absence_days).toBe(22); // 平日の欠勤は減らない
  });

  describe('勤務時間', () => {
    test('clock_out が null の打刻は勤務時間に入れない（出勤日数には入る）', () => {
      const result = calculateMonthlySummary({
        month: '2026-09',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [att('2026-09-01', '09:00', '18:00'), att('2026-09-02', '09:00', null)],
      });
      expect(result.attendance_days).toBe(2);
      expect(result.work_minutes).toBe(540);
    });

    test('clock_out が undefined の打刻も勤務時間に入れない', () => {
      const result = calculateMonthlySummary({
        month: '2026-09',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [{ work_date: '2026-09-01', clock_in: '2026-09-01T09:00:00+09:00' }],
      });
      expect(result.attendance_days).toBe(1);
      expect(result.work_minutes).toBe(0);
    });

    test('日をまたいだ勤務は出勤日の勤務として合計する', () => {
      // 9/1 22:00 出勤 → 9/2 02:00 退勤 = 240 分。出勤日は 9/1 の 1 日だけ
      const result = calculateMonthlySummary({
        month: '2026-09',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [att('2026-09-01', '22:00', '02:00', '2026-09-02')],
      });
      expect(result.attendance_days).toBe(1);
      expect(result.work_minutes).toBe(240);
      expect(result.absence_days).toBe(21); // 9/2 は打刻がないので欠勤
    });

    test('Date オブジェクトの時刻でも計算できる（pg は TIMESTAMPTZ を Date で返す）', () => {
      const result = calculateMonthlySummary({
        month: '2026-09',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [
          {
            work_date: '2026-09-01',
            clock_in: new Date('2026-09-01T00:00:00Z'),
            clock_out: new Date('2026-09-01T08:30:00Z'),
          },
        ],
      });
      expect(result.work_minutes).toBe(510);
      expect(result.work_hours).toBe(8.5);
    });

    test('分未満は切り捨て、時間は小数第 2 位に丸める', () => {
      // 100 分 59 秒 → 100 分 → 1.67 時間
      const result = calculateMonthlySummary({
        month: '2026-09',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [
          {
            work_date: '2026-09-01',
            clock_in: '2026-09-01T09:00:00+09:00',
            clock_out: '2026-09-01T10:40:59+09:00',
          },
        ],
      });
      expect(result.work_minutes).toBe(100);
      expect(result.work_hours).toBe(1.67);
    });

    test('退勤が出勤以前・不正な時刻の打刻は勤務時間に足さない（出勤日数には入る）', () => {
      const result = calculateMonthlySummary({
        month: '2026-09',
        today: '2026-10-14',
        registrationDate: REGISTERED_LONG_AGO,
        attendances: [
          att('2026-09-01', '18:00', '09:00'),
          { work_date: '2026-09-02', clock_in: 'invalid', clock_out: 'invalid' },
        ],
      });
      expect(result.attendance_days).toBe(2);
      expect(result.work_minutes).toBe(0);
    });
  });

  test('attendances / approvedLeaveDates を省略しても動く', () => {
    const result = calculateMonthlySummary({ month: '2026-09', today: '2026-10-14' });
    expect(result.absence_days).toBe(22);
    expect(result.period.from).toBe('2026-09-01');
  });
});
