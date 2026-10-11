// Express アプリ本体（listen はしない。テストで supertest から読み込むため）
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const employeesRouter = require('./routes/employees');
const attendancesRouter = require('./routes/attendances');
const leaveRequestsRouter = require('./routes/leaveRequests');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.disable('x-powered-by');
// セキュリティ関連のヘッダーを付ける（CSP は helmet の既定: script-src 'self' など）
// 画面側はインラインの script / style / イベント属性を使わず、外部ファイルだけで動くようにしている
// ただし upgrade-insecure-requests だけは外す。ローカル（http://localhost）で動かすアプリのため、
// ブラウザによっては CSS / JS の読み込みが https に書き換えられて失敗するのを防ぐ
// また、スタイルとフォントは自サーバーのファイルだけを許可する（既定のインライン style・外部 https の許可を外す）
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        upgradeInsecureRequests: null,
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
      },
    },
  })
);
app.use(express.json({ limit: '100kb' }));
// 画面（HTML / CSS / JS）を配信する。起動場所に依存しないようプロジェクトルート基準の絶対パスにする
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/employees', employeesRouter);
app.use('/api/attendances', attendancesRouter);
app.use('/api/leave-requests', leaveRequestsRouter);

// 存在しないルート
app.use(notFoundHandler);
// 共通のエラーハンドラ（最後に登録する）
app.use(errorHandler);

module.exports = app;
