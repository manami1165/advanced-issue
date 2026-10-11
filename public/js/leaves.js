// 休暇一覧画面: 休暇申請の一覧（社員で絞り込み）、ステータスの変更
'use strict';

const COLUMN_COUNT = 5;

const filterSelect = document.getElementById('filter-employee');
const reloadButton = document.getElementById('reload-button');
const listMessage = document.getElementById('list-message');
const tbody = document.getElementById('leave-tbody');

// 一覧の読み込みが前後した場合に、古い結果で上書きしないための番号
let loadSequence = 0;

// ステータスの表示（申請中・承認・却下）。クラス名は決まった値からだけ作る
function createStatusCell(status) {
  const td = document.createElement('td');
  const badge = document.createElement('span');
  const known = Object.prototype.hasOwnProperty.call(STATUS_LABELS, status);
  badge.className = known ? `badge badge-${status}` : 'badge';
  badge.textContent = known ? STATUS_LABELS[status] : status;
  td.appendChild(badge);
  return td;
}

// ステータス変更欄（セレクト + 変更ボタン）を作る
function createStatusChangeCell(leave) {
  const td = document.createElement('td');
  const wrap = document.createElement('div');
  wrap.className = 'inline-controls';

  const select = document.createElement('select');
  select.setAttribute('aria-label', `${leave.leave_date} ${leave.employee_name} のステータス`);
  Object.keys(STATUS_LABELS).forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = STATUS_LABELS[value];
    select.appendChild(option);
  });
  select.value = leave.status;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-primary btn-small';
  button.textContent = '変更';
  // 今と同じステータスのときは押せないようにする
  button.disabled = true;
  select.addEventListener('change', () => {
    button.disabled = select.value === leave.status;
  });
  button.addEventListener('click', () => changeStatus(leave, select, button));

  wrap.appendChild(select);
  wrap.appendChild(button);
  td.appendChild(wrap);
  return td;
}

// 休暇申請1件分の行を作る（社員名・理由はユーザー入力なので textContent で入れる）
function createLeaveRow(leave) {
  const tr = document.createElement('tr');
  tr.appendChild(createCell(leave.leave_date, 'nowrap'));
  tr.appendChild(createCell(leave.employee_name));
  tr.appendChild(createCell(leave.reason || '', 'reason'));
  tr.appendChild(createStatusCell(leave.status));
  tr.appendChild(createStatusChangeCell(leave));
  return tr;
}

// 休暇申請の一覧を読み込む（絞り込みの社員が選ばれていればその社員だけ）
async function loadLeaves() {
  loadSequence += 1;
  const sequence = loadSequence;
  const employeeId = filterSelect.value;
  const query = employeeId === '' ? '' : `?employee_id=${encodeURIComponent(employeeId)}`;
  reloadButton.disabled = true;
  try {
    const leaves = await apiRequest(`/leave-requests${query}`);
    if (sequence !== loadSequence) {
      return; // 読み込み中に絞り込みが変わった
    }
    if (leaves.length === 0) {
      showTableMessage(tbody, COLUMN_COUNT, '休暇申請はありません');
      return;
    }
    tbody.replaceChildren(...leaves.map(createLeaveRow));
  } catch (err) {
    if (sequence !== loadSequence) {
      return;
    }
    showTableMessage(tbody, COLUMN_COUNT, '-');
    showMessage(listMessage, err.message, 'error');
  } finally {
    if (sequence === loadSequence) {
      reloadButton.disabled = false;
    }
  }
}

// ステータスを変更する
async function changeStatus(leave, select, button) {
  const newStatus = select.value;
  clearMessage(listMessage);
  // 送信中はセレクトとボタンを無効にする（連打防止）
  select.disabled = true;
  try {
    await runWithButtonDisabled(button, () =>
      apiRequest(`/leave-requests/${leave.id}/status`, {
        method: 'PATCH',
        body: { status: newStatus },
      })
    );
  } catch (err) {
    showMessage(listMessage, err.message, 'error');
    select.disabled = false;
    return;
  }
  showMessage(
    listMessage,
    `${leave.leave_date} ${leave.employee_name} の休暇を「${STATUS_LABELS[newStatus]}」に変更しました`,
    'success'
  );
  // 一覧を読み直す（読み込みに失敗したときはそのエラーが表示される）
  await loadLeaves();
}

filterSelect.addEventListener('change', () => {
  clearMessage(listMessage);
  loadLeaves();
});
reloadButton.addEventListener('click', () => {
  clearMessage(listMessage);
  loadLeaves();
});

// 初期表示: 絞り込み用の社員を読み込んでから一覧を表示する
async function init() {
  try {
    await fillEmployeeSelect(filterSelect, 'すべての社員');
  } catch (err) {
    showMessage(listMessage, err.message, 'error');
  }
  await loadLeaves();
}

init();
