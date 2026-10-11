// サーバー起動用のエントリポイント
const app = require('./app');
const pool = require('./db/pool');

const PORT = Number(process.env.PORT) || 3000;
// 既定はローカルからの接続のみ受け付ける（外部公開する場合だけ HOST を指定する）
const HOST = process.env.HOST || '127.0.0.1';

const server = app.listen(PORT, HOST, () => {
  console.log(`サーバーを起動しました: http://${HOST}:${PORT}`);
});

// 終了シグナルを受けたら、受付を止めて DB プールを閉じる
function shutdown() {
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
