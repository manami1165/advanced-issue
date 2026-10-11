// 月次レポート画面: 社員と年月を選んで、勤務時間・出勤日数・遅刻回数を表示する
'use strict';

const reportForm = document.getElementById('report-form');
const reportEmployeeSelect = document.getElementById('report-employee');
const reportMonthInput = document.getElementById('report-month');
const reportSubmitButton = document.getElementById('report-submit');
const reportMessage = document.getElementById('report-message');
const reportResult = document.getElementById('report-result');
const reportName = document.getElementById('report-name');
const reportPeriod = document.getElementById('report-period');
const reportWorkTime = document.getElementById('report-work-time');
const reportAttendanceDays = document.getElementById('report-attendance-days');
const reportLateCount = document.getElementById('report-late-count');

// 表示中の結果を隠す（社員・年月を変えたときに古い結果を残さない）
function hideReport() {
  reportResult.hidden = true;
}

// レポートを画面に表示する（社員名はユーザー入力なので textContent で入れる）
function renderReport(report) {
  reportName.textContent = report.employee_name;
  reportPeriod.textContent = `${report.year}年${report.month}月`;
  reportWorkTime.textContent = `${report.work_hours} 時間（${report.work_minutes} 分）`;
  reportAttendanceDays.textContent = `${report.attendance_days} 日`;
  reportLateCount.textContent = `${report.late_count} 回`;
  reportResult.hidden = false;
}

// 「表示」ボタンでレポートを取得する
reportForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (reportSubmitButton.disabled) {
    return; // 送信中の Enter キーなどでは送らない
  }
  clearMessage(reportMessage);
  hideReport();

  const employeeId = reportEmployeeSelect.value;
  // <input type="month"> の値は 'YYYY-MM'。未入力なら空文字のまま送り、チェックは API に任せる
  const [year = '', month = ''] = reportMonthInput.value.split('-');
  const query = `year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`;

  try {
    const report = await runWithButtonDisabled(reportSubmitButton, () =>
      apiRequest(`/employees/${encodeURIComponent(employeeId)}/monthly-report?${query}`)
    );
    renderReport(report);
  } catch (err) {
    // 社員ID・年月の不正や社員がいない場合は API のメッセージをそのまま表示する
    showMessage(reportMessage, err.message, 'error');
  }
});

reportEmployeeSelect.addEventListener('change', () => {
  clearMessage(reportMessage);
  hideReport();
});
reportMonthInput.addEventListener('input', () => {
  clearMessage(reportMessage);
  hideReport();
});

// 初期表示: 社員の選択肢を読み込み、年月は日本時間の当月にしておく
async function init() {
  reportMonthInput.value = getTokyoToday().slice(0, 7);
  try {
    const employees = await fillEmployeeSelect(reportEmployeeSelect);
    if (employees.length === 0) {
      reportSubmitButton.disabled = true;
      showMessage(reportMessage, '社員が登録されていません。社員一覧画面で登録してください', 'info');
    }
  } catch (err) {
    reportSubmitButton.disabled = true;
    showMessage(reportMessage, err.message, 'error');
  }
}

init();
