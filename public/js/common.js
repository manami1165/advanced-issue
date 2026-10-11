// 各画面で共通に使う処理（API 呼び出し、メッセージ表示、日付など）
// 注意: ユーザー入力由来の値は必ず textContent / createElement で描画し、HTML 文字列として組み立てない
'use strict';

// API のベース URL
const API_BASE = '/api';

// ネットワークエラー（サーバーに届かない）ときの文言
const NETWORK_ERROR_MESSAGE = 'サーバーに接続できませんでした。通信状態を確認してください';

// 休暇ステータスの値 → 表示名
const STATUS_LABELS = {
  pending: '申請中',
  approved: '承認',
  rejected: '却下',
};

// API を呼び出す共通関数
// 成功時はレスポンスの JSON を返す（204 はボディを読まずに null を返す）
// 失敗時は API の { error } のメッセージを持つ Error を投げる
async function apiRequest(path, options = {}) {
  const init = {
    method: options.method || 'GET',
    headers: { Accept: 'application/json' },
  };
  if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  let res;
  try {
    res = await fetch(API_BASE + path, init);
  } catch (err) {
    // サーバーが止まっている・ネットワークが切れているなど
    throw new Error(NETWORK_ERROR_MESSAGE);
  }

  // 204 No Content はボディがないので読まない
  if (res.status === 204) {
    return null;
  }

  // JSON として読めない場合（プロキシのエラーページなど）に備える
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }

  if (!res.ok) {
    // API が返したメッセージをそのまま使う
    if (data && typeof data.error === 'string') {
      throw new Error(data.error);
    }
    // { error } が無い想定外の応答のときだけ、ステータスコードを伝える
    throw new Error(`通信に失敗しました（ステータス: ${res.status}）`);
  }
  return data;
}

// メッセージ欄に成功・エラーのメッセージを表示する（type: 'success' | 'error' | 'info'）
function showMessage(element, text, type) {
  element.textContent = text;
  element.className = `message message-${type}`;
  element.hidden = false;
}

// メッセージ欄を消す
function clearMessage(element) {
  element.textContent = '';
  element.className = 'message';
  element.hidden = true;
}

// ボタンを無効にしてから処理を行い、終わったら元に戻す（連打による二重送信を防ぐ）
// 終了後は必ず有効に戻すので、条件によって無効のままにしたいボタンは呼び出し側で状態を再設定する
async function runWithButtonDisabled(button, task) {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    return await task();
  } finally {
    button.removeAttribute('aria-busy');
    button.disabled = false;
  }
}

// 表のセル（td）を作る。値は textContent で入れる
function createCell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) {
    td.className = className;
  }
  return td;
}

// 表の本体に「データがありません」などの1行メッセージを表示する
function showTableMessage(tbody, colspan, text) {
  tbody.replaceChildren();
  const tr = document.createElement('tr');
  const td = createCell(text, 'table-empty');
  td.colSpan = colspan;
  tr.appendChild(td);
  tbody.appendChild(tr);
}

// 日本時間の今日の日付（YYYY-MM-DD）
function getTokyoToday() {
  // en-CA ロケールは YYYY-MM-DD 形式になる
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// 時刻（ISO 文字列）を日本時間の HH:MM で表示する
function formatTime(isoString) {
  if (!isoString) {
    return '';
  }
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoString));
}

// 社員一覧を取得して select に選択肢を入れる
// firstOptionText を渡すと、先頭に value="" の選択肢を追加する
async function fillEmployeeSelect(select, firstOptionText) {
  const previous = select.value;
  const employees = await apiRequest('/employees');
  select.replaceChildren();
  if (firstOptionText) {
    const first = document.createElement('option');
    first.value = '';
    first.textContent = firstOptionText;
    select.appendChild(first);
  }
  employees.forEach((employee) => {
    const option = document.createElement('option');
    option.value = String(employee.id);
    // 社員名はユーザー入力なので textContent で入れる
    option.textContent = employee.name;
    select.appendChild(option);
  });
  // 再読み込み前に選んでいた社員がまだいれば選択を保つ
  if (previous && employees.some((e) => String(e.id) === previous)) {
    select.value = previous;
  }
  return employees;
}
