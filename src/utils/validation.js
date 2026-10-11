// 入力バリデーション・エラー用のユーティリティ

// INTEGER（SERIAL）の最大値。これを超える ID は DB でエラーになるため 400 にする
const MAX_INT = 2147483647;

// 社員名の最大文字数（VARCHAR(100)）
const NAME_MAX_LENGTH = 100;

// 休暇理由の最大文字数（DB は TEXT だが、極端に長い入力を防ぐためアプリ側で制限する）
const REASON_MAX_LENGTH = 500;

// 社員名に使えない制御文字（\u0000-\u001F と \u007F）
// \u0000 などは PostgreSQL が受け付けず 22021 エラー（500）になるため、事前に 400 で弾く
// eslint-disable-next-line no-control-regex
const NAME_CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

// 休暇理由に使えない制御文字（改行 \n・\r とタブ \t は許可する）
// eslint-disable-next-line no-control-regex
const REASON_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// 休暇ステータスの許可値
const LEAVE_STATUSES = ['pending', 'approved', 'rejected'];

// API で返すエラー（status と、クライアントに見せてよいメッセージを持つ）
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ID（正の整数）を解析する。数値または数字だけの文字列を受け付け、不正なら null
function parseId(value) {
  let n;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value)) {
    n = Number(value);
  } else {
    return null;
  }
  if (!Number.isInteger(n) || n < 1 || n > MAX_INT) {
    return null;
  }
  return n;
}

// 社員名を検証して trim 済みの値を返す。不正なら HttpError(400) を投げる
function validateEmployeeName(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, '社員名を入力してください');
  }
  const name = value.trim();
  // VARCHAR(100) は文字数で数えるため、サロゲートペアも1文字として数える
  if ([...name].length > NAME_MAX_LENGTH) {
    throw new HttpError(400, `社員名は${NAME_MAX_LENGTH}文字以内で入力してください`);
  }
  if (NAME_CONTROL_CHARS.test(name)) {
    throw new HttpError(400, '社員名に改行・タブなどの制御文字は使えません');
  }
  return name;
}

// 休暇理由を検証して trim 済みの値を返す（任意項目。未指定・空文字・空白のみは null）
// 不正なら HttpError(400) を投げる
function validateLeaveReason(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, 'reason は文字列で指定してください');
  }
  const reason = value.trim();
  if (reason === '') {
    return null;
  }
  // サロゲートペアも1文字として数える（コードポイント数）
  if ([...reason].length > REASON_MAX_LENGTH) {
    throw new HttpError(400, `${REASON_MAX_LENGTH}文字以内で入力してください`);
  }
  if (REASON_CONTROL_CHARS.test(reason)) {
    throw new HttpError(400, '休暇理由に使えない制御文字が含まれています（改行・タブは使えます）');
  }
  return reason;
}

module.exports = {
  MAX_INT,
  NAME_MAX_LENGTH,
  REASON_MAX_LENGTH,
  LEAVE_STATUSES,
  HttpError,
  parseId,
  validateEmployeeName,
  validateLeaveReason,
};
