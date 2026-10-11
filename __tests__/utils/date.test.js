// src/utils/date.js のテスト（純粋関数）
const {
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
} = require('../../src/utils/date');

// Date だけを偽物にする（supertest などが使うタイマーは本物のまま）
const DO_NOT_FAKE = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
];

describe('TIME_ZONE', () => {
  test('日本時間（Asia/Tokyo）である', () => {
    expect(TIME_ZONE).toBe('Asia/Tokyo');
  });
});

describe('getTokyoDateString', () => {
  test('UTC 14:59:59.999 は日本時間でまだ同じ日', () => {
    expect(getTokyoDateString(new Date('2026-03-31T14:59:59.999Z'))).toBe('2026-03-31');
  });

  test('UTC 15:00:00 は日本時間で翌日になる', () => {
    expect(getTokyoDateString(new Date('2026-03-31T15:00:00.000Z'))).toBe('2026-04-01');
  });

  test('年をまたぐ境界（UTC 12/31 15:00 は日本時間 1/1）', () => {
    expect(getTokyoDateString(new Date('2025-12-31T14:59:59Z'))).toBe('2025-12-31');
    expect(getTokyoDateString(new Date('2025-12-31T15:00:00Z'))).toBe('2026-01-01');
  });

  test('うるう日の境界（UTC 2/28 15:00 は日本時間 2/29）', () => {
    expect(getTokyoDateString(new Date('2024-02-28T15:00:00Z'))).toBe('2024-02-29');
  });

  describe('引数を省略したときは現在時刻を使う', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    test('fake timers で固定した時刻（Intl でも固定されること）で日本時間の日付を返す', () => {
      jest.useFakeTimers({ doNotFake: DO_NOT_FAKE, now: new Date('2026-09-30T15:30:00Z') });
      // UTC では 9/30 だが、日本時間では 10/1
      expect(new Date().toISOString().slice(0, 10)).toBe('2026-09-30');
      expect(getTokyoDateString()).toBe('2026-10-01');
      expect(getTokyoMonthString()).toBe('2026-10');
    });

    test('UTC 14:59 に固定すると日本時間でも同じ日', () => {
      jest.useFakeTimers({ doNotFake: DO_NOT_FAKE, now: new Date('2026-09-30T14:59:00Z') });
      expect(getTokyoDateString()).toBe('2026-09-30');
      expect(getTokyoMonthString()).toBe('2026-09');
    });
  });
});

describe('getTokyoMonthString', () => {
  test('日本時間の YYYY-MM を返す（月末 UTC 15:00 で翌月になる）', () => {
    expect(getTokyoMonthString(new Date('2026-10-31T14:59:59Z'))).toBe('2026-10');
    expect(getTokyoMonthString(new Date('2026-10-31T15:00:00Z'))).toBe('2026-11');
  });
});

describe('isValidDateString', () => {
  test.each([
    ['2026-10-14'],
    ['2024-02-29'], // うるう年の 2/29
    ['2000-01-01'], // 範囲の下限
    ['2100-12-31'], // 範囲の上限
    ['2026-12-31'],
  ])('%s は正しい日付', (value) => {
    expect(isValidDateString(value)).toBe(true);
  });

  test.each([
    ['2023-02-29', 'うるう年でない 2/29'],
    ['2100-02-29', '2100 年はうるう年ではない'],
    ['2026-02-30', '存在しない 2/30'],
    ['2026-04-31', '存在しない 4/31'],
    ['2026-13-01', '13 月'],
    ['2026-00-10', '0 月'],
    ['2026-10-00', '0 日'],
    ['2026-10-32', '32 日'],
    ['1999-12-31', '範囲の下限より前'],
    ['2101-01-01', '範囲の上限より後'],
    ['0099-01-01', 'Date.UTC が 1900 年代に読み替える年'],
    ['2026-1-1', '0 埋めなし'],
    ['2026/10/14', '区切りがスラッシュ'],
    ['2026-10-14T00:00:00Z', '時刻付き'],
    [' 2026-10-14', '前に空白'],
    ['', '空文字'],
  ])('%s は不正（%s）', (value) => {
    expect(isValidDateString(value)).toBe(false);
  });

  test.each([[null], [undefined], [20261014], [{}], [['2026-10-14']]])(
    '文字列以外（%p）は不正',
    (value) => {
      expect(isValidDateString(value)).toBe(false);
    }
  );
});

describe('isValidMonthString', () => {
  test.each([['2026-10'], ['2000-01'], ['2100-12'], ['2024-02']])('%s は正しい', (value) => {
    expect(isValidMonthString(value)).toBe(true);
  });

  test.each([
    ['2026-13'],
    ['2026-00'],
    ['2026-1'],
    ['1999-12'],
    ['2101-01'],
    ['2026/10'],
    ['2026-10-01'],
    [''],
    [null],
    [undefined],
    [202610],
    [['2026-10']],
  ])('%p は不正', (value) => {
    expect(isValidMonthString(value)).toBe(false);
  });
});

describe('addDays', () => {
  test('月・年をまたいで加減算できる', () => {
    expect(addDays('2026-10-14', 1)).toBe('2026-10-15');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-10-14', 0)).toBe('2026-10-14');
  });

  test('うるう年・平年の 2 月末をまたぐ', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('isWeekday', () => {
  test.each([
    ['2026-10-12', true], // 月
    ['2026-10-13', true], // 火
    ['2026-10-14', true], // 水
    ['2026-10-15', true], // 木
    ['2026-10-16', true], // 金
    ['2026-10-17', false], // 土
    ['2026-10-18', false], // 日
    ['2024-02-29', true], // 木（うるう日）
  ])('%s は平日=%p', (value, expected) => {
    expect(isWeekday(value)).toBe(expected);
  });
});

describe('getMonthRange', () => {
  test('月の 1 日と末日を返す', () => {
    expect(getMonthRange('2026-10')).toEqual({ first: '2026-10-01', last: '2026-10-31' });
    expect(getMonthRange('2026-09')).toEqual({ first: '2026-09-01', last: '2026-09-30' });
    expect(getMonthRange('2026-12')).toEqual({ first: '2026-12-01', last: '2026-12-31' });
  });

  test('2 月はうるう年なら 29 日、平年なら 28 日まで', () => {
    expect(getMonthRange('2024-02')).toEqual({ first: '2024-02-01', last: '2024-02-29' });
    expect(getMonthRange('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' });
    expect(getMonthRange('2000-02').last).toBe('2000-02-29'); // 400 で割り切れる年はうるう年
  });
});

describe('eachDate', () => {
  test('両端を含む日付の配列を返す（月またぎ）', () => {
    expect(eachDate('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  test('from と to が同じなら 1 件', () => {
    expect(eachDate('2026-10-14', '2026-10-14')).toEqual(['2026-10-14']);
  });

  test('from > to なら空配列', () => {
    expect(eachDate('2026-10-02', '2026-10-01')).toEqual([]);
  });
});

describe('maxDate / minDate', () => {
  test('日付文字列の大きい方・小さい方を返す', () => {
    expect(maxDate('2026-09-30', '2026-10-01')).toBe('2026-10-01');
    expect(maxDate('2026-10-01', '2026-09-30')).toBe('2026-10-01');
    expect(minDate('2026-09-30', '2026-10-01')).toBe('2026-09-30');
    expect(minDate('2026-10-01', '2026-09-30')).toBe('2026-09-30');
  });
});
