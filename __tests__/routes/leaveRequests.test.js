// 休暇申請 API のテスト（/api/leave-requests）
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

// pg のエラーを模したオブジェクト
function pgError(code, constraint, message) {
  const err = new Error(message);
  err.code = code;
  err.constraint = constraint;
  return err;
}

function internalDbError() {
  return pgError('42703', undefined, 'column "secret" does not exist: SELECT lr.secret FROM leave_requests');
}

function expectInternalError(res) {
  expect(res.status).toBe(500);
  expect(res.body).toEqual(INTERNAL_ERROR);
  expect(res.text).not.toMatch(/column|SELECT|secret|42703|stack/);
}

const found = (rows = [{ '?column?': 1 }]) => ({ rows, rowCount: rows.length });
const none = () => ({ rows: [], rowCount: 0 });

const LEAVE = {
  id: 7,
  employee_id: 1,
  leave_date: '2026-10-14',
  reason: '通院のため',
  status: 'pending',
  created_at: '2026-10-10T00:00:00.000Z',
  updated_at: '2026-10-10T00:00:00.000Z',
};

let consoleErrorSpy;
beforeEach(() => {
  pool.query.mockReset();
  pool.connect.mockReset();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('GET /api/leave-requests', () => {
  test('200: employee_id なしなら全件（社員名付き）', async () => {
    const rows = [{ ...LEAVE, employee_name: '山田太郎' }];
    pool.query.mockResolvedValueOnce(found(rows));

    const res = await request(app).get('/api/leave-requests');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/JOIN employees/);
    expect(sql).not.toMatch(/WHERE/);
    expect(params).toBeUndefined();
  });

  test('200: employee_id が空文字なら全件', async () => {
    pool.query.mockResolvedValueOnce(none());
    const res = await request(app).get('/api/leave-requests?employee_id=');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('200: employee_id で絞り込む', async () => {
    const rows = [{ ...LEAVE, employee_name: '山田太郎' }];
    pool.query.mockResolvedValueOnce(found()).mockResolvedValueOnce(found(rows));

    const res = await request(app).get('/api/leave-requests?employee_id=1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    expect(pool.query.mock.calls[0][1]).toEqual([1]);
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toMatch(/WHERE lr\.employee_id = \$1/);
    expect(params).toEqual([1]);
  });

  test.each([['abc'], ['0'], ['-1'], ['1.5'], ['1&employee_id=2']])(
    '400: employee_id が不正（%s）',
    async (id) => {
      const res = await request(app).get(`/api/leave-requests?employee_id=${id}`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'employee_id が不正です' });
      expect(pool.query).not.toHaveBeenCalled();
    }
  );

  test('404: 存在しない社員', async () => {
    pool.query.mockResolvedValueOnce(none());
    const res = await request(app).get('/api/leave-requests?employee_id=999');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '社員が見つかりません' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('500: 全件取得の DB エラーは内部情報を返さない', async () => {
    pool.query.mockRejectedValueOnce(internalDbError());
    const res = await request(app).get('/api/leave-requests');
    expectInternalError(res);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('500: 絞り込み時の DB エラーは内部情報を返さない', async () => {
    pool.query.mockResolvedValueOnce(found()).mockRejectedValueOnce(internalDbError());
    const res = await request(app).get('/api/leave-requests?employee_id=1');
    expectInternalError(res);
  });
});

describe('POST /api/leave-requests', () => {
  const VALID = { employee_id: 1, leave_date: '2026-10-14', reason: '通院のため' };

  test('201: 休暇を申請する（ステータスは DB の DEFAULT で pending）', async () => {
    pool.query.mockResolvedValueOnce(found([LEAVE]));

    const res = await request(app).post('/api/leave-requests').send(VALID);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(LEAVE);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO leave_requests \(employee_id, leave_date, reason\)/);
    expect(sql).toMatch(/VALUES \(\$1, \$2, \$3\)/);
    expect(params).toEqual([1, '2026-10-14', '通院のため']);
  });

  test('201: body の status は受け付けない（承認済みで登録できない）', async () => {
    pool.query.mockResolvedValueOnce(found([LEAVE]));
    const res = await request(app)
      .post('/api/leave-requests')
      .send({ ...VALID, status: 'approved' });
    expect(res.status).toBe(201);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/status\s*\)/);
    expect(params).not.toContain('approved');
  });

  test('201: 過去の日付も申請できる', async () => {
    pool.query.mockResolvedValueOnce(found([{ ...LEAVE, leave_date: '2020-01-06' }]));
    const res = await request(app)
      .post('/api/leave-requests')
      .send({ employee_id: '1', leave_date: '2020-01-06' }); // 月曜
    expect(res.status).toBe(201);
    expect(pool.query.mock.calls[0][1]).toEqual([1, '2020-01-06', null]);
  });

  test.each([
    [undefined, null, '未指定'],
    [null, null, 'null'],
    ['', null, '空文字'],
    ['   ', null, '空白のみ'],
    ['  通院  ', '通院', '前後の空白は除く'],
    ['通院\nのため', '通院\nのため', '改行を含む'],
    ['通院\tのため', '通院\tのため', 'タブを含む'],
  ])('201: 理由 %p は %p として保存する（%s）', async (reason, saved) => {
    pool.query.mockResolvedValueOnce(found([LEAVE]));
    const res = await request(app)
      .post('/api/leave-requests')
      .send({ employee_id: 1, leave_date: '2026-10-14', reason });
    expect(res.status).toBe(201);
    expect(pool.query.mock.calls[0][1]).toEqual([1, '2026-10-14', saved]);
  });

  test('201: 理由 500 文字は申請できる', async () => {
    pool.query.mockResolvedValueOnce(found([LEAVE]));
    const reason = 'あ'.repeat(500);
    const res = await request(app).post('/api/leave-requests').send({ ...VALID, reason });
    expect(res.status).toBe(201);
    expect(pool.query.mock.calls[0][1][2]).toBe(reason);
  });

  test('201: うるう日（平日）は申請できる', async () => {
    pool.query.mockResolvedValueOnce(found([LEAVE]));
    const res = await request(app)
      .post('/api/leave-requests')
      .send({ employee_id: 1, leave_date: '2024-02-29' });
    expect(res.status).toBe(201);
  });

  test.each([
    [{ leave_date: '2026-10-14' }, 'employee_id は必須です'],
    [{ employee_id: null, leave_date: '2026-10-14' }, 'employee_id は必須です'],
    [{ employee_id: '', leave_date: '2026-10-14' }, 'employee_id は必須です'],
    [{ employee_id: 'abc', leave_date: '2026-10-14' }, 'employee_id が不正です'],
    [{ employee_id: 0, leave_date: '2026-10-14' }, 'employee_id が不正です'],
    [{ employee_id: 1 }, 'leave_date は必須です'],
    [{ employee_id: 1, leave_date: null }, 'leave_date は必須です'],
    [{ employee_id: 1, leave_date: '' }, 'leave_date は必須です'],
  ])('400: %p は「%s」', async (body, message) => {
    const res = await request(app).post('/api/leave-requests').send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: message });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test.each([
    ['2026/10/14'],
    ['2026-10-1'],
    ['2026-02-30'], // 存在しない日
    ['2023-02-29'], // 平年の 2/29
    ['1999-12-31'], // 範囲外
    ['2101-01-03'], // 範囲外
    [20261014], // 数値
  ])('400: leave_date が不正（%p）', async (leaveDate) => {
    const res = await request(app)
      .post('/api/leave-requests')
      .send({ employee_id: 1, leave_date: leaveDate });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'leave_date は YYYY-MM-DD 形式の正しい日付で指定してください' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test.each([['2026-10-17'], ['2026-10-18']])('400: 土日（%s）は申請できない', async (leaveDate) => {
    const res = await request(app)
      .post('/api/leave-requests')
      .send({ employee_id: 1, leave_date: leaveDate });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '休暇は平日のみ申請できます' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400: 理由 501 文字は「500文字以内で入力してください」', async () => {
    const res = await request(app)
      .post('/api/leave-requests')
      .send({ ...VALID, reason: 'あ'.repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '500文字以内で入力してください' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400: 理由に制御文字', async () => {
    const res = await request(app)
      .post('/api/leave-requests')
      .send({ ...VALID, reason: '通院\u0000のため' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: '休暇理由に使えない制御文字が含まれています（改行・タブは使えます）',
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('400: 理由が文字列以外', async () => {
    const res = await request(app)
      .post('/api/leave-requests')
      .send({ ...VALID, reason: 123 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'reason は文字列で指定してください' });
  });

  test('400: ボディなし', async () => {
    const res = await request(app).post('/api/leave-requests');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'employee_id は必須です' });
  });

  test('409: 同じ日の重複申請（UNIQUE 違反 23505）は「すでに休暇申請済みです」', async () => {
    pool.query.mockRejectedValueOnce(
      pgError(
        '23505',
        'leave_requests_employee_id_leave_date_key',
        'duplicate key value violates unique constraint "leave_requests_employee_id_leave_date_key"'
      )
    );
    const res = await request(app).post('/api/leave-requests').send(VALID);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'すでに休暇申請済みです' });
    expect(res.text).not.toMatch(/duplicate|constraint/);
  });

  test('404: 存在しない社員（外部キー違反 23503）', async () => {
    pool.query.mockRejectedValueOnce(
      pgError(
        '23503',
        'leave_requests_employee_id_fkey',
        'insert or update on table "leave_requests" violates foreign key constraint'
      )
    );
    const res = await request(app).post('/api/leave-requests').send({ ...VALID, employee_id: 999 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '社員が見つかりません' });
    expect(res.text).not.toMatch(/foreign key|leave_requests/);
  });

  test('500: 想定外の DB エラーは内部情報を返さない', async () => {
    pool.query.mockRejectedValueOnce(internalDbError());
    const res = await request(app).post('/api/leave-requests').send(VALID);
    expectInternalError(res);
  });
});

describe('PATCH /api/leave-requests/:id/status', () => {
  test.each([['pending'], ['approved'], ['rejected']])(
    '200: %s に変更できる（どの状態からでも変更できる）',
    async (status) => {
      const updated = { ...LEAVE, status };
      pool.query.mockResolvedValueOnce(found([updated]));

      const res = await request(app).patch('/api/leave-requests/7/status').send({ status });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toMatch(/SET status = \$1, updated_at = NOW\(\)/);
      expect(sql).toMatch(/WHERE id = \$2/);
      expect(params).toEqual([status, 7]);
    }
  );

  test('404: 存在しない休暇申請', async () => {
    pool.query.mockResolvedValueOnce(none());
    const res = await request(app).patch('/api/leave-requests/999/status').send({ status: 'approved' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '休暇申請が見つかりません' });
  });

  test.each([['abc'], ['0'], ['1.5'], ['2147483648']])('400: ID が不正（%s）', async (id) => {
    const res = await request(app)
      .patch(`/api/leave-requests/${id}/status`)
      .send({ status: 'approved' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '休暇申請IDが不正です' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test.each([[{}], [{ status: '' }], [{ status: 'APPROVED' }], [{ status: 'canceled' }], [{ status: ['approved'] }]])(
    '400: status が規定外（%p）',
    async (body) => {
      const res = await request(app).patch('/api/leave-requests/7/status').send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'status は pending / approved / rejected のいずれかを指定してください',
      });
      expect(pool.query).not.toHaveBeenCalled();
    }
  );

  test('400: ボディなし', async () => {
    const res = await request(app).patch('/api/leave-requests/7/status');
    expect(res.status).toBe(400);
  });

  test('500: 想定外の DB エラーは内部情報を返さない', async () => {
    pool.query.mockRejectedValueOnce(internalDbError());
    const res = await request(app).patch('/api/leave-requests/7/status').send({ status: 'approved' });
    expectInternalError(res);
  });
});
