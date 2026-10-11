// 社員一覧画面: 社員一覧（当月の集計つき）・社員の登録・社員の削除
'use strict';

const COLUMN_COUNT = 7;

const employeeForm = document.getElementById('employee-form');
const nameInput = document.getElementById('employee-name');
const submitButton = document.getElementById('employee-submit');
const formMessage = document.getElementById('form-message');
const listMessage = document.getElementById('list-message');
const reloadButton = document.getElementById('reload-button');
const tbody = document.getElementById('employee-tbody');
const summaryMonth = document.getElementById('summary-month');

// 勤務時間（分）を「◯時間◯分」で表示する
function formatWorkMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}時間${m}分`;
}

// 社員1人分の行を作る（summary が null のときは集計欄を「-」にする）
function createEmployeeRow(employee, summary) {
  const tr = document.createElement('tr');
  tr.appendChild(createCell(String(employee.id), 'num'));
  // 社員名はユーザー入力なので textContent（createCell）で入れる
  tr.appendChild(createCell(employee.name));
  if (summary) {
    tr.appendChild(createCell(formatWorkMinutes(summary.work_minutes), 'num'));
    tr.appendChild(createCell(`${summary.attendance_days}日`, 'num'));
    tr.appendChild(createCell(`${summary.absence_days}日`, 'num'));
    tr.appendChild(createCell(`${summary.leave_days}日`, 'num'));
  } else {
    for (let i = 0; i < 4; i += 1) {
      tr.appendChild(createCell('-', 'num'));
    }
  }

  const actionCell = document.createElement('td');
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'btn btn-danger btn-small';
  deleteButton.textContent = '削除';
  deleteButton.addEventListener('click', () => deleteEmployee(employee, deleteButton));
  actionCell.appendChild(deleteButton);
  tr.appendChild(actionCell);
  return tr;
}

// 社員一覧と各社員の当月集計を読み込んで表を描画する
// メッセージ欄は消さない（直前の操作の結果を残すため。消すのは呼び出し側）
async function loadEmployees() {
  reloadButton.disabled = true;
  try {
    const employees = await apiRequest('/employees');
    if (employees.length === 0) {
      showTableMessage(tbody, COLUMN_COUNT, '社員が登録されていません');
      return;
    }

    // 各社員の集計を並行して取得する。1人分の失敗で全体が表示されなくならないよう allSettled を使う
    const results = await Promise.allSettled(
      employees.map((employee) => apiRequest(`/employees/${employee.id}/summary`))
    );

    tbody.replaceChildren();
    let firstError = null;
    employees.forEach((employee, index) => {
      const result = results[index];
      const summary = result.status === 'fulfilled' ? result.value : null;
      if (result.status === 'rejected' && !firstError) {
        firstError = result.reason;
      }
      if (summary) {
        summaryMonth.textContent = summary.month;
      }
      tbody.appendChild(createEmployeeRow(employee, summary));
    });
    if (firstError) {
      // 集計が取れなかった社員がいる場合は API のメッセージを表示する
      showMessage(listMessage, firstError.message, 'error');
    }
  } catch (err) {
    showTableMessage(tbody, COLUMN_COUNT, '-');
    showMessage(listMessage, err.message, 'error');
  } finally {
    reloadButton.disabled = false;
  }
}

// 社員を削除する（確認ダイアログでキャンセルされたら何もしない）
async function deleteEmployee(employee, button) {
  const ok = window.confirm(
    `社員「${employee.name}」を削除しますか？\nこの社員の打刻と休暇申請もすべて削除されます。`
  );
  if (!ok) {
    return;
  }
  clearMessage(listMessage);
  try {
    await runWithButtonDisabled(button, () =>
      apiRequest(`/employees/${employee.id}`, { method: 'DELETE' })
    );
  } catch (err) {
    showMessage(listMessage, err.message, 'error');
    return;
  }
  showMessage(listMessage, `社員「${employee.name}」を削除しました`, 'success');
  // 一覧と集計を読み直す（読み込みに失敗したときはそのエラーが表示される）
  await loadEmployees();
}

// 社員の登録フォーム送信
employeeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMessage(formMessage);
  // 入力チェックは API に任せ、API のメッセージをそのまま表示する
  try {
    const created = await runWithButtonDisabled(submitButton, () =>
      apiRequest('/employees', { method: 'POST', body: { name: nameInput.value } })
    );
    nameInput.value = '';
    showMessage(formMessage, `社員「${created.name}」を登録しました（ID: ${created.id}）`, 'success');
  } catch (err) {
    showMessage(formMessage, err.message, 'error');
    return;
  }
  // 一覧と集計を読み直す
  clearMessage(listMessage);
  await loadEmployees();
});

reloadButton.addEventListener('click', () => {
  clearMessage(listMessage);
  loadEmployees();
});

// 初期表示
summaryMonth.textContent = getTokyoToday().slice(0, 7);
loadEmployees();
