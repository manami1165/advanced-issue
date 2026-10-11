// 社員 API のテスト（/api/employees）
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

// 内部情報を含む DB エラー（500 のレスポンスに漏れないことを確認する）
function internalDbError() {
  const err = new Error('relation "employees" does not exist: SELECT secret FROM employees');
  err.code = '42P01';
  return err;
}

// 500 のレスポンスに内部情報が含まれないことを確認する
function expectInternalError(res) {
  expect(res.status).toBe(500);
  expect(res.body).toEqual(INTERNAL_ERROR);
  expect(res.text).not.toMatch(/relation|SELECT|secret|42P01|stack/);
}

let consoleErrorSpy;
beforeEach(() => {
  pool.query.mockReset();
  pool.connect.mockReset();
  // 500 のときのログ出力をテスト結果に出さない
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
  jest.useRealTimers();
});

describe('GET /api/employees', () => {
  test('200: 社員一覧を返す', async () => {
    const rows = [
      { id: 1, name: '山田太郎', created_at: '2026-10-01T00:00:00.000Z' },
      { id: 2, name: '佐藤花子', created_at: '2026-10-02T00:00:00.000Z' },
    ];
    pool.query.mockResolvedValueOnce({ rows, rowCount: 2 });

    const res = await request(app).get('/api/employees');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toMatch(/FROM employees ORDER BY id/);
  });

  test('200: 社員がいなければ空配列', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('500: DB エラーは内部情報を返さない（ログには出す）', async () => {
    pool.query.mockRejectedValueOnce(internalDbError());
    const res = await request(app).get('/api/employees');
    expectInternalError(res);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe('POST /api/employees', () => {
  test('201: 前後の空白を除いた名前で登録し、プレースホルダで渡す', async () => {
    const created = { id: 3, name: '山田太郎', created_at: '2026-10-14T00:00:00.000Z' };
    pool.query.mockResolvedValueOnce({ rows: [created], rowCount: 1 });

    const res = await request(app).post('/api/employees').send({ name: '  山田太郎  ' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(created);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO employees \(name\) VALUES \(\$1\)/);
    expect(params).toEqual(['山田太郎']);
  });

  test('201: 100 文字の名前は登録できる', async () => {
    const name = 'あ'.repeat(100);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name }], rowCount: 1 });
    const res = await request(app).post('/api/employees').send({ name });
    expect(res.status).toBe(201);
    expect(pool.query.mock.calls[0][1]).toEqual([name]);
  });

  test.each([
    [{}, '名前なし'],
    [{ name: '' }, '空文字'],
    [{ name: '   ' }, 'スペースのみ'],
    [{ name: '　' }, '全角スペースのみ'],
    [{ name: null }, 'null'],
    [{ name: 123 }, '数値'],
  ])('400: %p は「社員名を入力してください」（%s）', async (body) => {
    const res = await request(app).post('/api/employees').send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '社員名を入力してください' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400: ボディなしでも 400（500 にしない）', async () => {
    const res = await request(app).post('/api/employees');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '社員名を入力してください' });
  });

  test('400: 101 文字は上限超過', async () => {
    const res = await request(app).post('/api/employees').send({ name: 'あ'.repeat(101) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '社員名は100文字以内で入力してください' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400: 制御文字を含む名前', async () => {
    const res = await request(app).post('/api/employees').send({ name: '山田\u0000太郎' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '社員名に改行・タブなどの制御文字は使えません' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400: JSON として壊れたボディ', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Content-Type', 'application/json')
      .send('{"name": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'リクエストのJSONが不正です' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('413: 大きすぎるボディ', async () => {
    const res = await request(app)
      .post('/api/employees')
      .send({ name: 'a'.repeat(200 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'リクエストが大きすぎます' });
  });

  test('4xx: 対応していない文字コードは固定文言で返す（内部の詳細を返さない）', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Content-Type', 'application/json; charset=x-unknown')
      .send('{"name":"山田"}');
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'リクエストが不正です' });
  });

  test('409: 想定外の UNIQUE 違反（制約名が未登録）は汎用メッセージ', async () => {
    const err = new Error('duplicate key value violates unique constraint "x"');
    err.code = '23505';
    err.constraint = 'unknown_key';
    pool.query.mockRejectedValueOnce(err);
    const res = await request(app).post('/api/employees').send({ name: '山田' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'すでに登録されています' });
  });

  test('500: DB エラーは内部情報を返さない', async () => {
    pool.query.mockRejectedValueOnce(internalDbError());
    const res = await request(app).post('/api/employees').send({ name: '山田' });
    expectInternalError(res);
  });
});

describe('DELETE /api/employees/:id', () => {
  test('204: 削除できたら本文なし', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app).delete('/api/employees/5');
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM employees WHERE id = \$1/);
    expect(params).toEqual([5]);
  });

  test('404: 存在しない社員', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).delete('/api/employees/999');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '社員が見つかりません' });
  });

  test.each([['abc'], ['0'], ['-1'], ['1.5'], ['2147483648'], ['1e3']])(
    '400: ID が不正（%s）',
    async (id) => {
      const res = await request(app).delete(`/api/employees/${id}`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: '社員IDが不正です' });
      expect(pool.query).not.toHaveBeenCalled();
    }
  );

  test('500: DB エラーは内部情報を返さない', async () => {
    pool.query.mockRejectedValueOnce(internalDbError());
    const res = await request(app).delete('/api/employees/1');
    expectInternalError(res);
  });
});

describe('GET /api/employees/:id/summary', () => {
  // 社員・打刻・休暇の順に呼ばれる pool.query の戻り値を設定する
  function mockSummaryQueries({ employee, attendances = [], leaveDates = [] }) {
    pool.query
      .mockResolvedValueOnce({ rows: employee ? [employee] : [], rowCount: employee ? 1 : 0 })
      .mockResolvedValueOnce({ rows: attendances, rowCount: attendances.length })
      .mockResolvedValueOnce({
        rows: leaveDates.map((d) => ({ leave_date: d })),
        rowCount: leaveDates.length,
      });
  }

  const EMPLOYEE = { id: 1, name: '山田太郎', registration_date: '2026-01-05' };

  test('200: month 指定（過去の月）の集計を返す', async () => {
    fixNow('2026-10-14T03:00:00Z'); // 日本時間 2026-10-14 12:00
    mockSummaryQueries({
      employee: EMPLOYEE,
      attendances: [
        {
          work_date: '2026-09-01',
          clock_in: new Date('2026-09-01T00:00:00Z'),
          clock_out: new Date('2026-09-01T09:00:00Z'),
        },
        {
          // 土曜の休日出勤
          work_date: '2026-09-05',
          clock_in: new Date('2026-09-05T01:00:00Z'),
          clock_out: null,
        },
      ],
      leaveDates: ['2026-09-01', '2026-09-02'],
    });

    const res = await request(app).get('/api/employees/1/summary?month=2026-09');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      employee_id: 1,
      employee_name: '山田太郎',
      month: '2026-09',
      period: { from: '2026-09-01', judge_to: '2026-09-30', record_to: '2026-09-30' },
      work_minutes: 540,
      work_hours: 9,
      attendance_days: 2,
      leave_days: 1, // 9/1 は打刻があるので出勤扱い
      absence_days: 20, // 平日 22 - 出勤 1（9/1）- 休暇 1（9/2）
    });

    // 社員の登録日は日本時間で求める
    expect(pool.query.mock.calls[0][0]).toMatch(/AT TIME ZONE 'Asia\/Tokyo'/);
    expect(pool.query.mock.calls[0][1]).toEqual([1]);
    // 打刻・休暇は対象月の 1 日〜月末で取得する
    expect(pool.query.mock.calls[1][1]).toEqual([1, '2026-09-01', '2026-09-30']);
    expect(pool.query.mock.calls[2][1]).toEqual([1, '2026-09-01', '2026-09-30']);
  });

  test('200: 休暇は承認済み（approved）だけを取得する（pending / rejected は数えない）', async () => {
    fixNow('2026-10-14T03:00:00Z');
    mockSummaryQueries({ employee: EMPLOYEE });
    await request(app).get('/api/employees/1/summary?month=2026-09');
    const leaveSql = pool.query.mock.calls[2][0];
    expect(leaveSql).toMatch(/FROM leave_requests/);
    expect(leaveSql).toMatch(/status = 'approved'/);
    expect(leaveSql).not.toMatch(/pending|rejected/);
  });

  test('200: month 省略時は日本時間の当月（UTC では前月末でも日本時間の翌月 1 日）', async () => {
    // UTC 2026-09-30 15:30 = 日本時間 2026-10-01 00:30
    fixNow('2026-09-30T15:30:00Z');
    mockSummaryQueries({ employee: { ...EMPLOYEE, registration_date: '2026-01-05' } });

    const res = await request(app).get('/api/employees/1/summary');

    expect(res.status).toBe(200);
    expect(res.body.month).toBe('2026-10');
    // 当月 1 日なので欠勤判定する日はない
    expect(res.body.period).toEqual({ from: '2026-10-01', judge_to: null, record_to: '2026-10-01' });
    expect(res.body.absence_days).toBe(0);
    expect(pool.query.mock.calls[1][1]).toEqual([1, '2026-10-01', '2026-10-31']);
  });

  test('200: 当月は前日までを欠勤判定し、今日の出勤は数える', async () => {
    fixNow('2026-10-14T03:00:00Z'); // 日本時間 2026-10-14（水）
    mockSummaryQueries({
      employee: EMPLOYEE,
      attendances: [
        {
          work_date: '2026-10-14',
          clock_in: new Date('2026-10-14T00:00:00Z'),
          clock_out: null,
        },
      ],
    });

    const res = await request(app).get('/api/employees/1/summary?month=');

    expect(res.status).toBe(200);
    expect(res.body.month).toBe('2026-10');
    expect(res.body.period).toEqual({
      from: '2026-10-01',
      judge_to: '2026-10-13',
      record_to: '2026-10-14',
    });
    expect(res.body.attendance_days).toBe(1);
    expect(res.body.absence_days).toBe(9);
  });

  test('200: 登録日が月の途中なら登録日から数える', async () => {
    fixNow('2026-10-14T03:00:00Z');
    mockSummaryQueries({ employee: { ...EMPLOYEE, registration_date: '2026-09-15' } });
    const res = await request(app).get('/api/employees/1/summary?month=2026-09');
    expect(res.status).toBe(200);
    expect(res.body.period.from).toBe('2026-09-15');
    expect(res.body.absence_days).toBe(12);
  });

  test('200: 未来の月はすべて 0', async () => {
    fixNow('2026-10-14T03:00:00Z');
    mockSummaryQueries({ employee: EMPLOYEE });
    const res = await request(app).get('/api/employees/1/summary?month=2026-11');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      period: { from: '2026-11-01', judge_to: null, record_to: null },
      work_minutes: 0,
      attendance_days: 0,
      leave_days: 0,
      absence_days: 0,
    });
  });

  test.each([['2026-13'], ['2026-00'], ['2026-1'], ['1999-12'], ['2101-01'], ['2026/10'], ['abc']])(
    '400: month の形式が不正（%s）',
    async (month) => {
      const res = await request(app).get(`/api/employees/1/summary?month=${month}`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'month は YYYY-MM 形式で指定してください' });
      expect(pool.query).not.toHaveBeenCalled();
    }
  );

  test('400: month が複数指定（配列）', async () => {
    const res = await request(app).get('/api/employees/1/summary?month=2026-09&month=2026-10');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'month は YYYY-MM 形式で指定してください' });
  });

  test.each([['abc'], ['0'], ['1.5']])('400: 社員 ID が不正（%s）', async (id) => {
    const res = await request(app).get(`/api/employees/${id}/summary`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '社員IDが不正です' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('404: 存在しない社員（打刻・休暇は取得しない）', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/employees/999/summary?month=2026-09');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '社員が見つかりません' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('500: 打刻の取得で DB エラー', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [EMPLOYEE], rowCount: 1 })
      .mockRejectedValueOnce(internalDbError())
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/employees/1/summary?month=2026-09');
    expectInternalError(res);
  });
});

describe('存在しないルート', () => {
  test('404: JSON でエラーを返す', async () => {
    const res = await request(app).get('/api/unknown');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '指定されたURLは存在しません' });
  });

  test('X-Powered-By ヘッダーを返さない', async () => {
    const res = await request(app).get('/api/unknown');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
