// 月次レポートの計算（純粋関数）
// 勤務時間・出勤日数は月次集計（calculateMonthlySummary）と同じルールで計算し、
// それに遅刻回数を加える。
//  - 遅刻: 出勤時刻（日本時間）が 9:00:00.000 より後。ちょうど 9:00:00.000 は遅刻ではない
//  - 遅刻回数は、集計期間（period.from 〜 record_to）にある平日の打刻だけを数える
//    （土日の休日出勤は始業時刻がないため遅刻にしない）
// 日本時間の時刻は UTC+9 のオフセットで計算する（日本は夏時間がないため固定で正しい）。
// サーバーの TZ 設定には依存しない。

const { isWeekday } = require('./date');
const { calculateMonthlySummary } = require('./summary');

// 日本時間の UTC からのずれ（ミリ秒）
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;
// 1日のミリ秒
const DAY_MS = 24 * 60 * 60 * 1000;
// 始業時刻（日本時間 9:00:00.000 を 0時からのミリ秒で表したもの）
const START_OF_WORK_MS = 9 * 60 * 60 * 1000;

// 出勤時刻（Date または ISO 文字列）が日本時間で 9:00:00.000 より後なら true
// 不正な値（null・解釈できない文字列など）は遅刻とは判定せず false を返す
function isLateClockIn(clockIn) {
  if (clockIn === null || clockIn === undefined) {
    return false;
  }
  const millis = clockIn instanceof Date ? clockIn.getTime() : new Date(clockIn).getTime();
  if (!Number.isFinite(millis)) {
    return false;
  }
  // 日本時間の 0時からの経過ミリ秒（負の値にならないよう剰余を補正する）
  const tokyoMillisOfDay = (((millis + TOKYO_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return tokyoMillisOfDay > START_OF_WORK_MS;
}

// 月次レポートを計算する
// month: 'YYYY-MM', today: 日本時間の今日 'YYYY-MM-DD', registrationDate: 登録日 'YYYY-MM-DD'
// attendances: [{ work_date: 'YYYY-MM-DD', clock_in: Date|string, clock_out: Date|string|null }]
function calculateMonthlyReport({ month, today, registrationDate, attendances = [] }) {
  // 勤務時間・出勤日数は月次集計と同じ結果を使う（休暇は使わないので渡さない）
  const summary = calculateMonthlySummary({
    month,
    today,
    registrationDate,
    attendances,
  });

  // 遅刻回数: 集計期間内・平日・9:00 より後の出勤
  let lateCount = 0;
  const from = summary.period.from;
  const recordTo = summary.period.record_to;
  if (recordTo !== null) {
    for (const row of attendances) {
      if (row.work_date < from || row.work_date > recordTo) {
        continue;
      }
      if (isWeekday(row.work_date) && isLateClockIn(row.clock_in)) {
        lateCount += 1;
      }
    }
  }

  return {
    work_minutes: summary.work_minutes,
    work_hours: summary.work_hours,
    attendance_days: summary.attendance_days,
    late_count: lateCount,
  };
}

module.exports = { isLateClockIn, calculateMonthlyReport };
