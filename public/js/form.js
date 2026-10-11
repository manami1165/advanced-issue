// 打刻・休暇申請画面: 社員を選んで出勤・退勤の打刻、休暇の申請
'use strict';

const employeeSelect = document.getElementById('employee-select');
const employeeMessage = document.getElementById('employee-message');
const todayStatus = document.getElementById('today-status');
const clockInButton = document.getElementById('clock-in-button');
const clockOutButton = document.getElementById('clock-out-button');
const clockMessage = document.getElementById('clock-message');
const leaveForm = document.getElementById('leave-form');
const leaveDateInput = document.getElementById('leave-date');
const leaveReasonInput = document.getElementById('leave-reason');
const reasonCount = document.getElementById('reason-count');
const leaveAppliedNote = document.getElementById('leave-applied-note');
const leaveSubmitButton = document.getElementById('leave-submit');
const leaveMessage = document.getElementById('leave-message');

// 選択中の社員がすでに休暇申請している日付（'YYYY-MM-DD' の集合）
let appliedLeaveDates = new Set();
// 申請済みの日付を読み込み中かどうか（読み込み中は申請ボタンを押せないようにする）
let isLeaveDatesLoading = false;
// 休暇申請を送信中かどうか（送信中は申請ボタンを有効に戻さない）
let isLeaveSubmitting = false;
// 打刻を送信中かどうか（送信中は出勤・退勤の両方を押せないようにする）
let isClockSubmitting = false;
// 社員切り替え時の読み込みが前後した場合に、古い結果で上書きしないための番号
let loadSequence = 0;

// 選択中の社員 ID（未選択なら空文字）
function getSelectedEmployeeId() {
  return employeeSelect.value;
}

// 打刻ボタンの状態を更新する（社員未選択・送信中は無効）
function updateClockButtonsState() {
  const disabled = isClockSubmitting || getSelectedEmployeeId() === '';
  clockInButton.disabled = disabled;
  clockOutButton.disabled = disabled;
}

// 休暇申請ボタンの状態を更新する（社員未選択・日付未入力・読み込み中・送信中・申請済みなら非活性）
function updateLeaveButtonState() {
  const date = leaveDateInput.value;
  const alreadyApplied = date !== '' && appliedLeaveDates.has(date);
  leaveAppliedNote.hidden = !alreadyApplied;
  leaveSubmitButton.disabled =
    isLeaveSubmitting ||
    isLeaveDatesLoading ||
    getSelectedEmployeeId() === '' ||
    date === '' ||
    alreadyApplied;
}

// 本日の打刻状況を表示する
async function loadTodayAttendance(employeeId) {
  const today = getTokyoToday();
  const attendances = await apiRequest(
    `/attendances?employee_id=${encodeURIComponent(employeeId)}&month=${today.slice(0, 7)}`
  );
  const record = attendances.find((a) => a.work_date === today);
  if (!record) {
    todayStatus.textContent = '未出勤';
  } else if (!record.clock_out) {
    // 退勤前は退勤時刻を空白にする
    todayStatus.textContent = `出勤 ${formatTime(record.clock_in)} / 退勤`;
  } else {
    todayStatus.textContent = `出勤 ${formatTime(record.clock_in)} / 退勤 ${formatTime(record.clock_out)}`;
  }
}

// 指定した社員の休暇申請済みの日付を取得する
async function fetchAppliedLeaveDates(employeeId) {
  const leaves = await apiRequest(`/leave-requests?employee_id=${encodeURIComponent(employeeId)}`);
  return new Set(leaves.map((leave) => leave.leave_date));
}

// 選択中の社員の休暇申請済みの日付を読み直して、申請ボタンの状態に反映する
async function refreshAppliedLeaveDates() {
  const employeeId = getSelectedEmployeeId();
  const sequence = loadSequence;
  if (employeeId === '') {
    appliedLeaveDates = new Set();
    updateLeaveButtonState();
    return;
  }
  isLeaveDatesLoading = true;
  updateLeaveButtonState();
  try {
    const dates = await fetchAppliedLeaveDates(employeeId);
    // 読み込み中に別の社員が選ばれていたら結果を捨てる
    if (sequence === loadSequence) {
      appliedLeaveDates = dates;
    }
  } finally {
    if (sequence === loadSequence) {
      isLeaveDatesLoading = false;
      updateLeaveButtonState();
    }
  }
}

// 社員を選んだときに、本日の打刻状況と休暇申請済みの日付を読み込む
async function onEmployeeChange() {
  clearMessage(employeeMessage);
  clearMessage(clockMessage);
  clearMessage(leaveMessage);
  loadSequence += 1;
  const sequence = loadSequence;
  const employeeId = getSelectedEmployeeId();

  appliedLeaveDates = new Set();
  isLeaveDatesLoading = false;
  updateClockButtonsState();
  if (employeeId === '') {
    todayStatus.textContent = '社員を選んでください';
    updateLeaveButtonState();
    return;
  }

  todayStatus.textContent = '読み込み中…';
  try {
    await Promise.all([refreshAppliedLeaveDates(), loadTodayAttendance(employeeId)]);
  } catch (err) {
    if (sequence !== loadSequence) {
      return; // 途中で別の社員が選ばれた
    }
    todayStatus.textContent = '-';
    showMessage(employeeMessage, err.message, 'error');
  }
}

// 出勤・退勤の打刻（type: 'clock-in' | 'clock-out'）
async function clock(type) {
  const employeeId = getSelectedEmployeeId();
  if (employeeId === '' || isClockSubmitting) {
    return;
  }
  clearMessage(clockMessage);
  // 送信中は出勤・退勤の両方を無効にする（連打による二重打刻の防止）
  isClockSubmitting = true;
  updateClockButtonsState();
  try {
    const record = await apiRequest(`/attendances/${type}`, {
      method: 'POST',
      body: { employee_id: Number(employeeId) },
    });
    const text =
      type === 'clock-in'
        ? `出勤を打刻しました（${formatTime(record.clock_in)}）`
        : `退勤を打刻しました（${formatTime(record.clock_out)}）`;
    showMessage(clockMessage, text, 'success');
  } catch (err) {
    // 「すでに出勤済みです」などは API のメッセージをそのまま表示する
    showMessage(clockMessage, err.message, 'error');
  } finally {
    isClockSubmitting = false;
    updateClockButtonsState();
  }
  // 打刻後は本日の打刻状況を更新する
  try {
    if (employeeId === getSelectedEmployeeId()) {
      await loadTodayAttendance(employeeId);
    }
  } catch (err) {
    showMessage(employeeMessage, err.message, 'error');
  }
}

// 休暇申請フォームの送信
leaveForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (leaveSubmitButton.disabled) {
    return; // Enter キーでの送信など、非活性中は送らない
  }
  clearMessage(leaveMessage);
  const employeeId = getSelectedEmployeeId();
  const leaveDate = leaveDateInput.value;

  isLeaveSubmitting = true;
  updateLeaveButtonState();
  try {
    // 土日・500文字超えなどの入力チェックは API に任せ、API のメッセージをそのまま表示する
    await apiRequest('/leave-requests', {
      method: 'POST',
      body: {
        employee_id: Number(employeeId),
        leave_date: leaveDate,
        reason: leaveReasonInput.value,
      },
    });
    showMessage(
      leaveMessage,
      `${leaveDate} の休暇を申請しました（ステータス: ${STATUS_LABELS.pending}）`,
      'success'
    );
    leaveReasonInput.value = '';
    reasonCount.textContent = '0';
    appliedLeaveDates.add(leaveDate);
  } catch (err) {
    showMessage(leaveMessage, err.message, 'error');
  } finally {
    isLeaveSubmitting = false;
    updateLeaveButtonState();
  }

  // 申請済みの日付を読み直してボタンの状態に反映する（409 が返ったときもここで非活性になる）
  try {
    await refreshAppliedLeaveDates();
  } catch (err) {
    showMessage(employeeMessage, err.message, 'error');
  }
});

employeeSelect.addEventListener('change', onEmployeeChange);
leaveDateInput.addEventListener('input', () => {
  clearMessage(leaveMessage);
  updateLeaveButtonState();
});
leaveReasonInput.addEventListener('input', () => {
  // 文字数はサロゲートペアも1文字として数える（API と同じ数え方）
  reasonCount.textContent = String([...leaveReasonInput.value].length);
});
clockInButton.addEventListener('click', () => clock('clock-in'));
clockOutButton.addEventListener('click', () => clock('clock-out'));

// 初期表示: 社員の選択肢を読み込み、日付は今日（日本時間）にしておく
async function init() {
  leaveDateInput.value = getTokyoToday();
  try {
    const employees = await fillEmployeeSelect(employeeSelect, '社員を選んでください');
    if (employees.length === 0) {
      showMessage(employeeMessage, '社員が登録されていません。社員一覧画面で登録してください', 'info');
    }
  } catch (err) {
    showMessage(employeeMessage, err.message, 'error');
  }
  await onEmployeeChange();
}

init();
