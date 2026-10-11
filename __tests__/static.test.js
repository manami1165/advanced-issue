// 静的ファイル配信（public/）とセキュリティヘッダー（helmet）のテスト
// 画面の配信だけを確認するので DB は使わない（pool はモックにしておく）
const request = require('supertest');

jest.mock('../src/db/pool', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../src/db/pool');
const app = require('../src/app');

beforeEach(() => {
  pool.query.mockReset();
});

describe('静的ファイル配信', () => {
  test('GET / は社員一覧画面（index.html）を 200 / text/html で返す', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).toContain('社員一覧');
    // 静的ファイルの配信で DB には触れない
    expect(pool.query).not.toHaveBeenCalled();
  });

  test.each([
    ['/index.html', /^text\/html/],
    ['/form.html', /^text\/html/],
    ['/leaves.html', /^text\/html/],
    ['/style.css', /^text\/css/],
    ['/js/common.js', /javascript/],
    ['/js/index.js', /javascript/],
    ['/js/form.js', /javascript/],
    ['/js/leaves.js', /javascript/],
  ])('GET %s は 200 で返る', async (path, contentType) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(contentType);
  });

  test('3画面すべてに共通ナビゲーションがある', async () => {
    for (const path of ['/index.html', '/form.html', '/leaves.html']) {
      const res = await request(app).get(path);
      expect(res.text).toContain('href="/index.html"');
      expect(res.text).toContain('href="/form.html"');
      expect(res.text).toContain('href="/leaves.html"');
    }
  });

  test('HTML にインラインの script・イベント属性・style 属性がない（CSP で動かなくなるため）', async () => {
    for (const path of ['/index.html', '/form.html', '/leaves.html']) {
      const res = await request(app).get(path);
      // <script> は src 付きの外部ファイルだけ
      const scriptTags = res.text.match(/<script\b[^>]*>/gi) || [];
      expect(scriptTags.length).toBeGreaterThan(0);
      scriptTags.forEach((tag) => expect(tag).toMatch(/\bsrc=/));
      expect(res.text).not.toMatch(/\son[a-z]+\s*=/i);
      expect(res.text).not.toMatch(/\sstyle\s*=/i);
    }
  });

  test('存在しないファイルは従来どおり 404 の JSON を返す', async () => {
    const res = await request(app).get('/not-exists.html');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '指定されたURLは存在しません' });
  });

  test('public の外のファイル（パストラバーサル）は返さない', async () => {
    const res = await request(app).get('/..%2fpackage.json');
    expect(res.status).not.toBe(200);
    expect(res.text).not.toContain('"dependencies"');
  });
});

describe('セキュリティヘッダー（helmet）', () => {
  test('画面に X-Content-Type-Options: nosniff と CSP が付く', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    // スクリプトは同じオリジンの外部ファイルだけ許可する（インラインは不可）
    expect(csp).toMatch(/script-src 'self'(;|$)/);
    expect(csp).toMatch(/default-src 'self'/);
    // スタイル・フォントも同じオリジンのファイルだけ許可する（インライン style・外部 https は不可）
    expect(csp).toMatch(/style-src 'self'(;|$)/);
    expect(csp).toMatch(/font-src 'self'(;|$)/);
    expect(csp).toMatch(/object-src 'none'/);
    // ローカルの http で CSS / JS が https に書き換えられないよう外している
    expect(csp).not.toMatch(/upgrade-insecure-requests/);
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('API のレスポンスにもセキュリティヘッダーが付き、JSON は従来どおり返る', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual([]);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});
