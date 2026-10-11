// 打刻 API のテスト（/api/attendances）
// DB は src/db/pool.js をモックし、実 DB には接続しない。
// このアプリはトランザクションを使っていない（pool.connect を呼ばない）ため、pool.query だけを差し替える。
const request = require('supertest');

jest.mock('../../src/db/pool', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../../src/db/pool');
const app = require('../../src/app');

const INTERNAL_ERROR = { error: 'サーバー内部でエラーが発生しました' };

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

// pg のエラーを模したオブジェクト
function pgError(code, constraint, message) {
  const err = new Error(message);
  err.code = code;
  err.constraint = constraint;
  return err;
}

// 内部情報を含む DB エラー（500 のレスポンスに漏れないことを確認する）
function internalDbError() {
  return pgError('42P01', undefined, 'relation "attendances" does not exist: UPDATE attendances SET');
}

function expectInternalError(res) {
  expect(res.status).toBe(500);
  expect(res.body).toEqual(INTERNAL_ERROR);
  expect(res.text).not.toMatch(/relation|UPDATE|SELECT|42P01|stack/);
}

// pool.query の戻り値
const found = (rows = [{ '?column?': 1 }]) => ({ rows, rowCount: rows.length });
const none = () => ({ rows: [], rowCount: 0 });

const RECORD = {
  id: 10,
  employee_id: 1,
  work_date: '2026-10-14',
  clock_in: '2026-10-14T00:00:00.000Z',
  clock_out: null,
  created_at: '2026-10-14T00:00:00.000Z',
};

let consoleErrorSpy;
beforeEach(() => {
  pool.query.mockReset();
  pool.connect.mockReset();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  // 日本時間 2026-10-14（水）12:00 に固定
  fixNow('2026-10-14T03:00:00Z');
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
  jest.useRealTimers();
});

// employee_id の不正値（clock-in / clock-out 共通）
const INVALID_EMPLOYEE_IDS = [
  [{}, 'employee_id は必須です'],
  [{ employee_id: null }, 'employee_id は必須です'],
  [{ employee_id: '' }, 'employee_id は必須です'],
  [{ employee_id: 'abc' }, 'employee_id が不正です'],
  [{ employee_id: 0 }, 'employee_id が不正です'],
  [{ employee_id: -1 }, 'employee_id が不正です'],
  [{ employee_id: 1.5 }, 'employee_id が不正です'],
  [{ employee_id: '1.5' }, 'employee_id が不正です'],
  [{ employee_id: 2147483648 }, 'employee_id が不正です'],
  [{ employee_id: true }, 'employee_id が不正です'],
  [{ employee_id: [1] }, 'employee_id が不正です'],
];

describe('POST /api/attendances/clock-in', () => {
  test('201: 日本時間の今日を work_date にして出勤を記録する', async () => {
    pool.query.mockResolvedValueOnce(found([RECORD]));

    const res = await request(app).post('/api/attendances/clock-in').send({ employee_id: 1 });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(RECORD);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO attendances/);
    expect(sql).toMatch(/VALUES \(\$1, \$2, NOW\(\)\)/);
    expect(params).toEqual([1, '2026-10-14']);
  });

  test('201: employee_id は数字の文字列でもよい', async () => {
    pool.query.mockResolvedValueOnce(found([RECORD]));
    const res = await request(app).post('/api/attendances/clock-in').send({ employee_id: '1' });
    expect(res.status).toBe(201);
    expect(pool.query.mock.calls[0][1]).toEqual([1, '2026-10-14']);
  });

  test('201: UTC 14:59 は日本時間でまだ同じ日（23:59）', async () => {
    fixNow('2026-10-14T14:59:59Z');
    pool.query.mockResolvedValueOnce(found([RECORD]));
    await request(app).post('/api/attendances/clock-in').send({ employee_id: 1 });
    expect(pool.query.mock.calls[0][1]).toEqual([1, '2026-10-14']);
  });

  test('201: UTC 15:00 は日本時間で翌日（0:00）の出勤になる', async () => {
    fixNow('2026-10-14T15:00:00Z');
    pool.query.mockResolvedValueOnce(found([RECORD]));
    await request(app).post('/api/attendances/clock-in').send({ employee_id: 1 });
    expect(pool.query.mock.calls[0][1]).toEqual([1, '2026-10-15']);
  });

  test('201: 土日でも出勤打刻できる（休日出勤）', async () => {
    fixNow('2026-10-17T03:00:00Z'); // 日本時間 土曜
    pool.query.mockResolvedValueOnce(found([{ ...RECORD, work_date: '2026-10-17' }]));
    const res = await request(app).post('/api/attendances/clock-in').send({ employee_id: 1 });
    expect(res.status).toBe(201);
    expect(pool.query.mock.calls[0][1]).toEqual([1, '2026-10-17']);
  });

  test.each(INVALID_EMPLOYEE_IDS)('400: %p は「%s」', async (body, message) => {
    const res = await request(app).post('/api/attendances/clock-in').send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: message });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('409: 同じ日の二重出勤（UNIQUE 違反 23505）は「すでに出勤済みです」', async () => {
    pool.query.mockRejectedValueOnce(
      pgError(
        '23505',
        'attendances_employee_id_work_date_key',
        'duplicate key value violates unique constraint "attendances_employee_id_work_date_key"'
      )
    );
    const res = await request(app).post('/api/attendances/clock-in').send({ employee_id: 1 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'すでに出勤済みです' });
    expect(res.text).not.toMatch(/duplicate|constraint/);
  });

  test('404: 存在しない社員（外部キー違反 23503）', async () => {
    pool.query.mockRejectedValueOnce(
      pgError(
        '23503',
        'attendances_employee_id_fkey',
        'insert or update on table "attendances" violates foreign key constraint'
      )
    );
    const res = await request(app).post('/api/attendances/clock-in').send({ employee_id: 999 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '社員が見つかりません' });
    expect(res.text).not.toMatch(/foreign key|attendances/);
  });

  test('500: 想定外の DB エラーは内部情報を返さない', async () => {
    pool.query.mockRejectedValueOnce(internalDbError());
    const res = await request(app).post('/api/attendances/clock-in').send({ employee_id: 1 });
    expectInternalError(res);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe('POST /api/attendances/clock-out', () => {
  test('200: 今日の未退勤の打刻を退勤にする', async () => {
    const updated = { ...RECORD, clock_out: '2026-10-14T09:00:00.000Z' };
    pool.query
      .mockResolvedValueOnce(found()) // 社員の存在確認
      .mockResolvedValueOnce(found([updated])); // 今日の打刻を UPDATE

    const res = await request(app).post('/api/attendances/clock-out').send({ employee_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(updated);
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[0][1]).toEqual([1]);
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toMatch(/UPDATE attendances/);
    expect(sql).toMatch(/clock_out IS NULL/);
    expect(params).toEqual([1, '2026-10-14']);
  });

  test('409: 今日すでに退勤済み', async () => {
    pool.query
      .mockResolvedValueOnce(found()) // 社員の存在確認
      .mockResolvedValueOnce(none()) // 今日の未退勤なし
      .mockResolvedValueOnce(found()); // 今日の打刻はある

    const res = await request(app).post('/api/attendances/clock-out').send({ employee_id: 1 });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'すでに退勤済みです' });
    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(pool.query.mock.calls[2][1]).toEqual([1, '2026-10-14']);
  });

  test('200: 前日から日をまたいだ退勤は前日（出勤日）の打刻を更新する', async () => {
    const updated = {
      ...RECORD,
      work_date: '2026-10-13',
      clock_in: '2026-10-13T13:00:00.000Z',
      clock_out: '2026-10-14T03:00:00.000Z',
    };
    pool.query
      .mockResolvedValueOnce(found()) // 社員の存在確認
      .mockResolvedValueOnce(none()) // 今日の未退勤なし
      .mockResolvedValueOnce(none()) // 今日の打刻なし
      .mockResolvedValueOnce(found([updated])); // 前日の未退勤を UPDATE

    const res = await request(app).post('/api/attendances/clock-out').send({ employee_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(updated);
    expect(pool.query).toHaveBeenCalledTimes(4);
    expect(pool.query.mock.calls[3][0]).toMatch(/clock_out IS NULL/);
    expect(pool.query.mock.calls[3][1]).toEqual([1, '2026-10-13']);
  });

  test('200: 日またぎの「前日」も日本時間で決める（UTC では同じ月でも日本時間は月初）', async () => {
    // UTC 2026-10-31 15:30 = 日本時間 2026-11-01 00:30 → 前日は 2026-10-31
    fixNow('2026-10-31T15:30:00Z');
    pool.query
      .mockResolvedValueOnce(found())
      .mockResolvedValueOnce(none())
      .mockResolvedValueOnce(none())
      .mockResolvedValueOnce(found([{ ...RECORD, work_date: '2026-10-31' }]));

    const res = await request(app).post('/api/attendances/clock-out').send({ employee_id: 1 });

    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[1][1]).toEqual([1, '2026-11-01']);
    expect(pool.query.mock.calls[3][1]).toEqual([1, '2026-10-31']);
  });

  test('400: 今日も前日も未退勤の出勤がない（出勤打刻なし）', async () => {
    pool.query
      .mockResolvedValueOnce(found())
      .mockResolvedValueOnce(none())
      .mockResolvedValueOnce(none())
      .mockResolvedValueOnce(none());

    const res = await request(app).post('/api/attendances/clock-out').send({ employee_id: 1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '出勤打刻がありません' });
    expect(pool.query).toHaveBeenCalledTimes(4);
  });

  test('404: 存在しない社員（打刻は更新しない）', async () => {
    pool.query.mockResolvedValueOnce(none());
    const res = await request(app).post('/api/attendances/clock-out').send({ employee_id: 999 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '社員が見つかりません' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test.each(INVALID_EMPLOYEE_IDS)('400: %p は「%s」', async (body, message) => {
    const res = await request(app).post('/api/attendances/clock-out').send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: message });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400: ボディなし', async () => {
    const res = await request(app).post('/api/attendances/clock-out');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'employee_id は必須です' });
  });

  test('500: UPDATE 中の想定外の DB エラーは内部情報を返さない', async () => {
    pool.query.mockResolvedValueOnce(found()).mockRejectedValueOnce(internalDbError());
    const res = await request(app).post('/api/attendances/clock-out').send({ employee_id: 1 });
    expectInternalError(res);
  });

  // 退勤時刻 > 出勤時刻 の CHECK 制約違反（23514）
  // 例: サーバーの時計が戻った・同じ瞬間に打刻した など
  const clockOutCheckError = () =>
    pgError(
      '23514',
      'attendances_clock_out_after_clock_in_check',
      'new row for relation "attendances" violates check constraint "attendances_clock_out_after_clock_in_check"'
    );

  test('400: 今日の打刻の UPDATE が CHECK 制約違反なら「退勤時刻が出勤時刻より前です」', async () => {
    pool.query
      .mockResolvedValueOnce(found()) // 社員の存在確認
      .mockRejectedValueOnce(clockOutCheckError()); // 今日の打刻を UPDATE

    const res = await request(app).post('/api/attendances/clock-out').send({ employee_id: 1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '退勤時刻が出勤時刻より前です' });
    expect(res.text).not.toMatch(/check constraint|attendances|23514/);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('400: 前日分の UPDATE が CHECK 制約違反でも「退勤時刻が出勤時刻より前です」', async () => {
    pool.query
      .mockResolvedValueOnce(found()) // 社員の存在確認
      .mockResolvedValueOnce(none()) // 今日の未退勤なし
      .mockResolvedValueOnce(none()) // 今日の打刻なし
      .mockRejectedValueOnce(clockOutCheckError()); // 前日の未退勤を UPDATE

    const res = await request(app).post('/api/attendances/clock-out').send({ employee_id: 1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '退勤時刻が出勤時刻より前です' });
    expect(res.text).not.toMatch(/check constraint|attendances|23514/);
    expect(pool.query).toHaveBeenCalledTimes(4);
  });

  test('500: 別の制約名の CHECK 違反（23514）は内部エラーにする', async () => {
    pool.query
      .mockResolvedValueOnce(found())
      .mockRejectedValueOnce(
        pgError(
          '23514',
          'attendances_other_check',
          'new row for relation "attendances" violates check constraint "attendances_other_check"'
        )
      );

    const res = await request(app).post('/api/attendances/clock-out').send({ employee_id: 1 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual(INTERNAL_ERROR);
    expect(res.text).not.toMatch(/check constraint|attendances_other_check|23514/);
  });
});

describe('GET /api/attendances', () => {
  test('200: 指定した月の打刻一覧を 1 日〜月末で取得する', async () => {
    const rows = [RECORD];
    pool.query.mockResolvedValueOnce(found()).mockResolvedValueOnce(found(rows));

    const res = await request(app).get('/api/attendances?employee_id=1&month=2024-02');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toMatch(/work_date BETWEEN \$2 AND \$3/);
    expect(params).toEqual([1, '2024-02-01', '2024-02-29']);
  });

  test('200: month 省略時は日本時間の当月', async () => {
    // UTC 2026-09-30 15:30 = 日本時間 2026-10-01
    fixNow('2026-09-30T15:30:00Z');
    pool.query.mockResolvedValueOnce(found()).mockResolvedValueOnce(none());

    const res = await request(app).get('/api/attendances?employee_id=1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(pool.query.mock.calls[1][1]).toEqual([1, '2026-10-01', '2026-10-31']);
  });

  test('200: month が空文字なら当月', async () => {
    pool.query.mockResolvedValueOnce(found()).mockResolvedValueOnce(none());
    const res = await request(app).get('/api/attendances?employee_id=1&month=');
    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[1][1]).toEqual([1, '2026-10-01', '2026-10-31']);
  });

  test.each([
    ['', 'employee_id は必須です'],
    ['?employee_id=', 'employee_id は必須です'],
    ['?employee_id=abc', 'employee_id が不正です'],
    ['?employee_id=0', 'employee_id が不正です'],
    ['?employee_id=1&employee_id=2', 'employee_id が不正です'],
    ['?employee_id=1&month=2026-13', 'month は YYYY-MM 形式で指定してください'],
    ['?employee_id=1&month=2026-1', 'month は YYYY-MM 形式で指定してください'],
    ['?employee_id=1&month=1999-12', 'month は YYYY-MM 形式で指定してください'],
    ['?employee_id=1&month=2026-10&month=2026-11', 'month は YYYY-MM 形式で指定してください'],
  ])('400: クエリ「%s」は「%s」', async (query, message) => {
    const res = await request(app).get(`/api/attendances${query}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: message });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('404: 存在しない社員', async () => {
    pool.query.mockResolvedValueOnce(none());
    const res = await request(app).get('/api/attendances?employee_id=999&month=2026-10');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '社員が見つかりません' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('500: 想定外の DB エラーは内部情報を返さない', async () => {
    pool.query.mockRejectedValueOnce(internalDbError());
    const res = await request(app).get('/api/attendances?employee_id=1&month=2026-10');
    expectInternalError(res);
  });
});
