// 月次集計の計算（純粋関数）
// ルールは docs/requirements.md「当月集計」に従う。
//  - 対象期間: 当月は1日〜前日（今日は欠勤判定に含めない。ただし今日の勤務時間・出勤は含める）
//              過去の月は1日〜月末
//  - 勤務時間: 退勤済みの打刻について（退勤 − 出勤）を合計する（休憩は考慮しない）
//  - 出勤日数: 打刻がある日の数（土日の打刻も休日出勤として数える）
//  - 休暇日数: 承認済みの休暇がある平日の数
//  - 欠勤日数: 平日のうち、打刻も承認済みの休暇もない日の数（祝日は考慮しない）
//  - 社員の登録日より前の日は数えない
//  - 同じ日に打刻と承認済みの休暇の両方がある場合は、出勤として数える
//
// 未来の月（今日の月より後）を指定された場合は、まだ判定できる日が1日もないため
// すべて 0 を返す（エラーにはしない。画面で月を進めたときに 0 表示になる想定）。

const {
  addDays,
  isWeekday,
  getMonthRange,
  eachDate,
  maxDate,
  minDate,
} = require('./date');

// 集計の対象期間を決める
// month: 'YYYY-MM', today: 日本時間の今日 'YYYY-MM-DD', registrationDate: 登録日（日本時間）'YYYY-MM-DD'
// 戻り値:
//  - from: 集計開始日（月初と登録日の遅い方）
//  - judgeTo: 欠勤・休暇の判定をする最終日（当月は前日、過去の月は月末）
//  - recordTo: 出勤日数・勤務時間を数える最終日（当月は今日、過去の月は月末）
//  - judgeTo / recordTo が null のときは対象日なし（未来の月）
function getSummaryPeriod({ month, today, registrationDate }) {
  const { first, last } = getMonthRange(month);
  const currentMonth = today.slice(0, 7);
  const from = registrationDate ? maxDate(first, registrationDate) : first;

  if (month > currentMonth) {
    // 未来の月: 対象日なし
    return { from, judgeTo: null, recordTo: null };
  }
  if (month === currentMonth) {
    // 当月: 欠勤・休暇は前日まで、出勤・勤務時間は今日まで
    return { from, judgeTo: minDate(last, addDays(today, -1)), recordTo: today };
  }
  // 過去の月: 月末まで
  return { from, judgeTo: last, recordTo: last };
}

// 時刻値（Date または文字列）をミリ秒に変換する
function toMillis(value) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

// 月次集計を計算する
// attendances: [{ work_date: 'YYYY-MM-DD', clock_in: Date|string, clock_out: Date|string|null }]
// approvedLeaveDates: 承認済み休暇の日付 ['YYYY-MM-DD', ...]
function calculateMonthlySummary({
  month,
  today,
  registrationDate,
  attendances = [],
  approvedLeaveDates = [],
}) {
  const period = getSummaryPeriod({ month, today, registrationDate });

  let totalMillis = 0;
  const attendanceDates = new Set();

  // 出勤日数・勤務時間（登録日〜recordTo の打刻のみ）
  if (period.recordTo !== null) {
    for (const row of attendances) {
      if (row.work_date < period.from || row.work_date > period.recordTo) {
        continue;
      }
      attendanceDates.add(row.work_date);
      if (row.clock_out !== null && row.clock_out !== undefined) {
        const diff = toMillis(row.clock_out) - toMillis(row.clock_in);
        // DB の CHECK で退勤 > 出勤 は保証されているが、念のため負の値は足さない
        if (Number.isFinite(diff) && diff > 0) {
          totalMillis += diff;
        }
      }
    }
  }

  // 休暇日数・欠勤日数（登録日〜judgeTo の平日のみ）
  const leaveSet = new Set(approvedLeaveDates);
  let leaveDays = 0;
  let absenceDays = 0;
  if (period.judgeTo !== null) {
    for (const date of eachDate(period.from, period.judgeTo)) {
      if (!isWeekday(date)) {
        continue;
      }
      if (attendanceDates.has(date)) {
        // 打刻があれば（承認済み休暇があっても）出勤として数える
        continue;
      }
      if (leaveSet.has(date)) {
        leaveDays += 1;
      } else {
        absenceDays += 1;
      }
    }
  }

  const workMinutes = Math.floor(totalMillis / 60000);
  return {
    month,
    period: {
      from: period.from,
      // 欠勤・休暇の判定期間（対象日がなければ null）
      judge_to:
        period.judgeTo !== null && period.from <= period.judgeTo ? period.judgeTo : null,
      // 出勤・勤務時間の集計期間（対象日がなければ null）
      record_to:
        period.recordTo !== null && period.from <= period.recordTo ? period.recordTo : null,
    },
    work_minutes: workMinutes,
    work_hours: Math.round((workMinutes / 60) * 100) / 100,
    attendance_days: attendanceDates.size,
    leave_days: leaveDays,
    absence_days: absenceDays,
  };
}

module.exports = { getSummaryPeriod, calculateMonthlySummary };
