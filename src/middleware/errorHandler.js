// 共通のエラーハンドラ
// すべてのエラーを { "error": "メッセージ" } の形で返す。
// 500 のときは内部の詳細を返さず、サーバーログにだけ出す。
const { HttpError } = require('../utils/validation');

// UNIQUE 制約名 → 409 のメッセージ
const UNIQUE_MESSAGES = {
  attendances_employee_id_work_date_key: 'すでに出勤済みです',
  leave_requests_employee_id_leave_date_key: 'すでに休暇申請済みです',
};

// CHECK 制約名 → 400 のメッセージ
// ここにない CHECK 違反は想定外として 500 のままにする
const CHECK_MESSAGES = {
  attendances_clock_out_after_clock_in_check: '退勤時刻が出勤時刻より前です',
};

// 404: 存在しないルート
function notFoundHandler(req, res) {
  res.status(404).json({ error: '指定されたURLは存在しません' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // アプリで判定したエラー
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }

  // JSON のパースエラー（express.json が投げる）
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'リクエストのJSONが不正です' });
  }
  // ボディが大きすぎる
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'リクエストが大きすぎます' });
  }
  // その他の body-parser のクライアントエラー（文字コード不正など）
  // err.message は内部の詳細を含みうるため返さず、固定文言にする
  if (
    err &&
    err.expose === true &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500
  ) {
    return res.status(err.status).json({ error: 'リクエストが不正です' });
  }

  // PostgreSQL のエラーコードを HTTP ステータスに変換する
  if (err && err.code === '23505') {
    // UNIQUE 違反: 同時押しなどで事前チェックをすり抜けた場合もここで 409 にする
    const message = UNIQUE_MESSAGES[err.constraint] || 'すでに登録されています';
    return res.status(409).json({ error: message });
  }
  if (
    err &&
    err.code === '23514' &&
    Object.prototype.hasOwnProperty.call(CHECK_MESSAGES, err.constraint)
  ) {
    // CHECK 違反: 退勤時刻が出勤時刻以前（時計のずれなど）の場合は 400 にする
    return res.status(400).json({ error: CHECK_MESSAGES[err.constraint] });
  }
  if (err && err.code === '23503') {
    // 外部キー違反: 参照先の社員が存在しない（削除された直後など）
    return res.status(404).json({ error: '社員が見つかりません' });
  }

  // 想定外のエラー: 詳細はログにだけ出す
  console.error('サーバー内部エラー:', err);
  return res.status(500).json({ error: 'サーバー内部でエラーが発生しました' });
}

module.exports = { notFoundHandler, errorHandler };
