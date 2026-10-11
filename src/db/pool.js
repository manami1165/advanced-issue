// PostgreSQL の接続プール
// 接続情報は .env（DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME）から読み込む。
const path = require('path');
const { Pool, types } = require('pg');

// プロジェクトルートの .env を読み込む（起動ディレクトリに依存しないよう絶対パスで指定）
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

// DATE 型（OID 1082）は JS の Date に変換せず 'YYYY-MM-DD' の文字列のまま受け取る。
// Date に変換するとサーバーのタイムゾーンで解釈され、日付がずれる原因になるため。
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// アイドル中の接続で発生したエラーでプロセスが落ちないようにログだけ出す
pool.on('error', (err) => {
  console.error('PostgreSQL プールで予期しないエラーが発生しました:', err.message);
});

module.exports = pool;
