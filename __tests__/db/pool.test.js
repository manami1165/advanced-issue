// src/db/pool.js のテスト
// pg と dotenv をモックして、実 DB への接続も .env の読み込みもしない。

jest.mock('pg', () => {
  const on = jest.fn();
  return {
    Pool: jest.fn(() => ({ on })),
    types: { setTypeParser: jest.fn() },
  };
});
jest.mock('dotenv', () => ({ config: jest.fn() }));

const ORIGINAL_ENV = process.env;

// 環境変数を差し替えて pool.js を読み込み直す
function loadPool(env) {
  process.env = { ...ORIGINAL_ENV, ...env };
  let pool;
  jest.isolateModules(() => {
    pool = require('../../src/db/pool');
  });
  return pool;
}

let pg;
let dotenv;
beforeEach(() => {
  jest.clearAllMocks();
  pg = require('pg');
  dotenv = require('dotenv');
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('src/db/pool.js', () => {
  test('環境変数の接続情報で Pool を作る（ポートは数値に変換する）', () => {
    loadPool({
      DB_HOST: 'db.example',
      DB_PORT: '5433',
      DB_USER: 'app',
      DB_PASSWORD: 'pw',
      DB_NAME: 'attendance',
    });
    expect(pg.Pool).toHaveBeenCalledWith({
      host: 'db.example',
      port: 5433,
      user: 'app',
      password: 'pw',
      database: 'attendance',
    });
  });

  test('DB_PORT がなければ port は undefined（pg の既定値を使う）', () => {
    loadPool({ DB_PORT: '' });
    expect(pg.Pool.mock.calls[0][0].port).toBeUndefined();
  });

  test('プロジェクトルートの .env を絶対パスで読み込む指定をしている', () => {
    loadPool({});
    const options = dotenv.config.mock.calls[0][0];
    expect(options.path).toMatch(/[\\/]\.env$/);
    expect(require('path').isAbsolute(options.path)).toBe(true);
  });

  test('DATE 型（OID 1082）は文字列のまま返す（タイムゾーンで日付がずれない）', () => {
    loadPool({});
    expect(pg.types.setTypeParser).toHaveBeenCalledWith(1082, expect.any(Function));
    const parser = pg.types.setTypeParser.mock.calls[0][1];
    expect(parser('2026-10-14')).toBe('2026-10-14');
  });

  test('アイドル接続のエラーはログに出すだけでプロセスを落とさない', () => {
    const pool = loadPool({});
    expect(pool.on).toHaveBeenCalledWith('error', expect.any(Function));
    const handler = pool.on.mock.calls.find(([event]) => event === 'error')[1];
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => handler(new Error('connection terminated'))).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
