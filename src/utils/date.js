// 日付計算のユーティリティ（純粋関数）
// 日付は 'YYYY-MM-DD' の文字列で扱い、日付の加減算は UTC の Date で行う。
// 「今日」は必ず日本時間（Asia/Tokyo）で決め、サーバーの TZ や DB の CURRENT_DATE に依存しない。

const TIME_ZONE = 'Asia/Tokyo';

// 受け付ける年の範囲。Date.UTC は 0〜99 年を 1900〜1999 年として扱うため、範囲を絞ってずれを防ぐ
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

// 年が受け付ける範囲内かどうか
function isYearInRange(year) {
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

// 日本時間の 'YYYY-MM-DD' を返す（now を渡せばその時刻で計算する。テスト用）
function getTokyoDateString(now = new Date()) {
  // en-CA ロケールは 'YYYY-MM-DD' 形式で出力される
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

// 日本時間の 'YYYY-MM' を返す
function getTokyoMonthString(now = new Date()) {
  return getTokyoDateString(now).slice(0, 7);
}

// 'YYYY-MM-DD' が実在する日付かどうか（年は 2000〜2100）
function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = value.split('-').map(Number);
  if (!isYearInRange(y)) {
    return false;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  // 2月30日などは Date が繰り上げるので、元の値と一致するかで判定する
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

// 'YYYY-MM' の形式かどうか（年は 2000〜2100、月は 01〜12）
function isValidMonthString(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return false;
  }
  return isYearInRange(Number(value.slice(0, 4)));
}

// 'YYYY-MM-DD' を UTC 0時の Date に変換する
function toUtcDate(dateString) {
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// UTC の Date を 'YYYY-MM-DD' に変換する
function fromUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

// 日付に days 日を足す（負数で引く）
function addDays(dateString, days) {
  const date = toUtcDate(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtcDate(date);
}

// 平日（月〜金）かどうか。祝日は考慮しない
function isWeekday(dateString) {
  const day = toUtcDate(dateString).getUTCDay();
  return day !== 0 && day !== 6;
}

// 'YYYY-MM' の1日と末日を返す
function getMonthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const first = fromUtcDate(new Date(Date.UTC(y, m - 1, 1)));
  // 翌月の0日 = 当月の末日
  const last = fromUtcDate(new Date(Date.UTC(y, m, 0)));
  return { first, last };
}

// from〜to（両端を含む）の日付の配列を返す。from > to なら空配列
function eachDate(from, to) {
  const result = [];
  if (from > to) {
    return result;
  }
  let current = from;
  while (current <= to) {
    result.push(current);
    current = addDays(current, 1);
  }
  return result;
}

// 'YYYY-MM-DD' 同士の大きい方・小さい方（文字列比較で正しく比較できる）
function maxDate(a, b) {
  return a > b ? a : b;
}
function minDate(a, b) {
  return a < b ? a : b;
}

module.exports = {
  TIME_ZONE,
  getTokyoDateString,
  getTokyoMonthString,
  isValidDateString,
  isValidMonthString,
  addDays,
  isWeekday,
  getMonthRange,
  eachDate,
  maxDate,
  minDate,
};
