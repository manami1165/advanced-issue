// 月次レポート API のテスト（GET /api/employees/:id/monthly-report?year=&month=）
// DB は src/db/pool.js をモックし、実 DB には接続しない。
// pool.query は「社員取得 → 打刻取得」の順にちょうど 2 回呼ばれる想定。
//
// 使うカレンダー（曜日は手計算で確認済み）
//  - 2026-10: 10/3 は土曜、10/4 は日曜、10/5 は月曜、10/20 は火曜
//  - 2026-09: 9/1 は火曜、9/5 は土曜
const request = require('supertest');

jest.mock('../../src/db/pool', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../../src/db/pool');
const app = require('../../src/app');

const INTERNAL_ERROR = { error: 'サーバー内部でエラーが発生しました' };
const YEAR_ERROR = { error: 'year は 2000〜2100 の整数で指定してください' };
const MONTH_ERROR = { error: 'month は 1〜12 の整数で指定してください' };

// Date だけを偽物にする（supertest が使うタイマーやイベントループは本物のまま）
function fixNow(isoString) {
  jest.useFakeTimers({
    now: new Date(isoString),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

// 内部情報を含む DB エラー（500 のレスポンスに漏れないことを確認する）
function internalDbError() {
  const err = new Error('relation "attendances" does not exist: SELECT secret FROM attendances');
  err.code = '42P01';
  return err;
}

function expectInternalError(res) {
  expect(res.status).toBe(500);
  expect(res.body).toEqual(INTERNAL_ERROR);
  expect(res.text).not.toMatch(/relation|SELECT|secret|42P01|stack/);
}

const EMPLOYEE = { id: 1, name: '山田太郎', registration_date: '2026-01-05' };

// 社員取得 → 打刻取得の順に pool.query の戻り値を設定する
function mockReportQueries({ employee = EMPLOYEE, attendances = [] } = {}) {
  pool.query
    .mockResolvedValueOnce({ rows: employee ? [employee] : [], rowCount: employee ? 1 : 0 })
    .mockResolvedValueOnce({ rows: attendances, rowCount: attendances.length });
}

// UTC の ISO 文字列で打刻を作る（pg は TIMESTAMPTZ を Date で返すので Date にする）
function att(workDate, clockInUtc, clockOutUtc) {
  return {
    work_date: workDate,
    clock_in: new Date(clockInUtc),
    clock_out: clockOutUtc === null ? null : new Date(clockOutUtc),
  };
}

let consoleErrorSpy;
beforeEach(() => {
  pool.query.mockReset();
  pool.connect.mockReset();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  // 日本時間 2026-10-20（火）12:00 に固定
  fixNow('2026-10-20T03:00:00Z');
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
  jest.useRealTimers();
});

describe('GET /api/employees/:id/monthly-report 正常系', () => {
  test('200: 過去の月のレポートを返す（遅刻の境目・土日を含む）', async () => {
    mockReportQueries({
      attendances: [
        // 9/1（火）日本時間 9:00:00 ちょうど〜18:00 → 遅刻ではない
        att('2026-09-01', '2026-09-01T00:00:00.000Z', '2026-09-01T09:00:00.000Z'),
        // 9/2（水）日本時間 9:00:01 → 遅刻。〜18:00:01 で 540 分
        att('2026-09-02', '2026-09-02T00:00:01.000Z', '2026-09-02T09:00:01.000Z'),
        // 9/5（土）日本時間 13:00 の休日出勤 → 遅刻に数えない。〜17:00 で 240 分
        att('2026-09-05', '2026-09-05T04:00:00.000Z', '2026-09-05T08:00:00.000Z'),
      ],
    });

    const res = await request(app).get('/api/employees/1/monthly-report?year=2026&month=9');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      employee_id: 1,
      employee_name: '山田太郎',
      year: 2026,
      month: 9,
      work_minutes: 1320,
      work_hours: 22,
      attendance_days: 3,
      late_count: 1,
    });
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('SQL はプレースホルダを使い、値はパラメータ配列で渡す', async () => {
    mockReportQueries();

    await request(app).get('/api/employees/1/monthly-report?year=2026&month=9');

    const [employeeSql, employeeParams] = pool.query.mock.calls[0];
    expect(employeeSql).toMatch(/FROM employees/);
    expect(employeeSql).toMatch(/\$1/);
    expect(employeeParams).toEqual([1]);

    const [attendanceSql, attendanceParams] = pool.query.mock.calls[1];
    expect(attendanceSql).toMatch(/FROM attendances/);
    expect(attendanceSql).toMatch(/\$1/);
    expect(attendanceSql).toMatch(/\$2/);
    expect(attendanceSql).toMatch(/\$3/);
    // 値を SQL 文字列に埋め込んでいない
    expect(attendanceSql).not.toMatch(/2026-09/);
    expect(attendanceParams).toEqual([1, '2026-09-01', '2026-09-30']);
  });

  test('200: month は "01" のようにゼロ埋めでもよい', async () => {
    mockReportQueries();
    const res = await request(app).get('/api/employees/1/monthly-report?year=2026&month=01');
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(res.body.month).toBe(1);
    expect(pool.query.mock.calls[1][1]).toEqual([1, '2026-01-01', '2026-01-31']);
  });

  test('200: うるう年の 2 月は 29 日まで取得する', async () => {
    mockReportQueries();
    await request(app).get('/api/employees/1/monthly-report?year=2024&month=2');
    expect(pool.query.mock.calls[1][1]).toEqual([1, '2024-02-01', '2024-02-29']);
  });

  test('200: 当月は今日まで数える（明日以降の打刻は数えない）', async () => {
    mockReportQueries({
      attendances: [
        // 10/3（土）10:00 出勤 → 遅刻に数えない
        att('2026-10-03', '2026-10-03T01:00:00.000Z', '2026-10-03T05:00:00.000Z'),
        // 10/4（日）9:30 出勤 → 遅刻に数えない
        att('2026-10-04', '2026-10-04T00:30:00.000Z', '2026-10-04T02:30:00.000Z'),
        // 10/5（月）9:00:00 ちょうど → 遅刻ではない
        att('2026-10-05', '2026-10-05T00:00:00.000Z', '2026-10-05T09:00:00.000Z'),
        // 10/20（火・今日）9:00:01 → 遅刻、未退勤
        att('2026-10-20', '2026-10-20T00:00:01.000Z', null),
        // 10/21（水・明日）通常ありえないが、数えない
        att('2026-10-21', '2026-10-21T01:00:00.000Z', '2026-10-21T09:00:00.000Z'),
      ],
    });

    const res = await request(app).get('/api/employees/1/monthly-report?year=2026&month=10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      employee_id: 1,
      employee_name: '山田太郎',
      year: 2026,
      month: 10,
      work_minutes: 900, // 240 + 120 + 540
      work_hours: 15,
      attendance_days: 4, // 10/3, 10/4, 10/5, 10/20
      late_count: 1, // 10/20 のみ
    });
    expect(pool.query.mock.calls[1][1]).toEqual([1, '2026-10-01', '2026-10-31']);
  });

  test('200: 未来の月はすべて 0', async () => {
    mockReportQueries({
      attendances: [att('2026-11-02', '2026-11-02T01:00:00.000Z', '2026-11-02T09:00:00.000Z')],
    });
    const res = await request(app).get('/api/employees/1/monthly-report?year=2026&month=11');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      year: 2026,
      month: 11,
      work_minutes: 0,
      work_hours: 0,
      attendance_days: 0,
      late_count: 0,
    });
  });

  test('200: 登録日より前の打刻は数えない', async () => {
    mockReportQueries({
      employee: { ...EMPLOYEE, registration_date: '2026-10-06' },
      attendances: [
        att('2026-10-05', '2026-10-05T01:00:00.000Z', '2026-10-05T09:00:00.000Z'),
        att('2026-10-06', '2026-10-06T01:00:00.000Z', '2026-10-06T09:00:00.000Z'),
      ],
    });
    const res = await request(app).get('/api/employees/1/monthly-report?year=2026&month=10');
    expect(res.status).toBe(200);
    expect(res.body.attendance_days).toBe(1);
    expect(res.body.late_count).toBe(1);
    expect(res.body.work_minutes).toBe(480);
  });

  test('200: 「今日」は日本時間で決める（UTC では前月末でも日本時間の翌月 1 日）', async () => {
    // UTC 2026-09-30 15:30 = 日本時間 2026-10-01 00:30 → 10 月は当月、10/1 の打刻を数える
    fixNow('2026-09-30T15:30:00Z');
    mockReportQueries({
      attendances: [att('2026-10-01', '2026-09-30T15:10:00.000Z', null)],
    });
    const res = await request(app).get('/api/employees/1/monthly-report?year=2026&month=10');
    expect(res.status).toBe(200);
    expect(res.body.attendance_days).toBe(1);
    // 日本時間 0:10 の出勤は遅刻ではない
    expect(res.body.late_count).toBe(0);
  });
});

describe('GET /api/employees/:id/monthly-report バリデーション', () => {
  test.each([['abc'], ['0'], ['-1'], ['1.5'], ['2147483648']])(
    '400: 社員 ID が不正（%s）',
    async (id) => {
      const res = await request(app).get(`/api/employees/${id}/monthly-report?year=2026&month=10`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: '社員IDが不正です' });
      expect(pool.query).not.toHaveBeenCalled();
    }
  );

  test('400: 社員 ID・year・month がすべて不正なら社員 ID のエラーを優先する', async () => {
    const res = await request(app).get('/api/employees/abc/monthly-report?year=abc&month=13');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '社員IDが不正です' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test.each([
    ['year 未指定', 'month=10'],
    ['year が空', 'year=&month=10'],
    ['year が 3 桁', 'year=999&month=10'],
    ['year が 5 桁', 'year=20260&month=10'],
    ['year が数字以外', 'year=abc&month=10'],
    ['year が小数', 'year=2026.5&month=10'],
    ['year が符号付き', 'year=+2026&month=10'],
    ['year が範囲外（1999）', 'year=1999&month=10'],
    ['year が範囲外（2101）', 'year=2101&month=10'],
    ['year が複数指定', 'year=2026&year=2025&month=10'],
  ])('400: %s', async (_label, query) => {
    const res = await request(app).get(`/api/employees/1/monthly-report?${query}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(YEAR_ERROR);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test.each([
    ['2000', 'year=2000&month=1', [1, '2000-01-01', '2000-01-31']],
    ['2100', 'year=2100&month=12', [1, '2100-12-01', '2100-12-31']],
  ])('200: year の境目 %s は OK', async (_label, query, params) => {
    mockReportQueries();
    const res = await request(app).get(`/api/employees/1/monthly-report?${query}`);
    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[1][1]).toEqual(params);
  });

  test('400: year も month も不正なら year のエラーを優先する', async () => {
    const res = await request(app).get('/api/employees/1/monthly-report?year=abc&month=13');
    expect(res.status).toBe(400);
    expect(res.body).toEqual(YEAR_ERROR);
  });

  test.each([
    ['month 未指定', 'year=2026'],
    ['month が空', 'year=2026&month='],
    ['month が 0', 'year=2026&month=0'],
    ['month が 00', 'year=2026&month=00'],
    ['month が 13', 'year=2026&month=13'],
    ['month が 3 桁', 'year=2026&month=010'],
    ['month が数字以外', 'year=2026&month=abc'],
    ['month が小数', 'year=2026&month=1.5'],
    ['month が負', 'year=2026&month=-1'],
    ['month が YYYY-MM 形式', 'year=2026&month=2026-10'],
    ['month が複数指定', 'year=2026&month=9&month=10'],
  ])('400: %s', async (_label, query) => {
    const res = await request(app).get(`/api/employees/1/monthly-report?${query}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual(MONTH_ERROR);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test.each([['1'], ['01'], ['9'], ['09'], ['12']])('200: month=%s は OK', async (month) => {
    mockReportQueries();
    const res = await request(app).get(`/api/employees/1/monthly-report?year=2026&month=${month}`);
    expect(res.status).toBe(200);
    expect(res.body.month).toBe(Number(month));
  });
});

describe('GET /api/employees/:id/monthly-report エラー', () => {
  test('404: 存在しない社員（打刻は取得しない）', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/employees/999/monthly-report?year=2026&month=10');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '社員が見つかりません' });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][1]).toEqual([999]);
  });

  test('500: 社員の取得で DB エラー（内部情報を返さない）', async () => {
    pool.query.mockRejectedValueOnce(internalDbError());
    const res = await request(app).get('/api/employees/1/monthly-report?year=2026&month=10');
    expectInternalError(res);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('500: 打刻の取得で DB エラー（内部情報を返さない）', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [EMPLOYEE], rowCount: 1 })
      .mockRejectedValueOnce(internalDbError());
    const res = await request(app).get('/api/employees/1/monthly-report?year=2026&month=10');
    expectInternalError(res);
  });
});
