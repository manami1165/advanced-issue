// src/utils/validation.js のテスト（純粋関数）
const {
  MAX_INT,
  NAME_MAX_LENGTH,
  REASON_MAX_LENGTH,
  LEAVE_STATUSES,
  HttpError,
  parseId,
  validateEmployeeName,
  validateLeaveReason,
} = require('../../src/utils/validation');

// 関数が投げた HttpError を取り出す（投げなければテスト失敗）
function catchHttpError(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('HttpError が投げられませんでした');
}

describe('定数', () => {
  test('上限値とステータスの許可値', () => {
    expect(MAX_INT).toBe(2147483647);
    expect(NAME_MAX_LENGTH).toBe(100);
    expect(REASON_MAX_LENGTH).toBe(500);
    expect(LEAVE_STATUSES).toEqual(['pending', 'approved', 'rejected']);
  });
});

describe('HttpError', () => {
  test('status とメッセージを持つ Error である', () => {
    const err = new HttpError(409, 'すでに出勤済みです');
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(409);
    expect(err.message).toBe('すでに出勤済みです');
  });
});

describe('parseId', () => {
  test.each([
    [1, 1],
    ['1', 1],
    [42, 42],
    ['42', 42],
    [2147483647, 2147483647], // INTEGER の最大値
    ['2147483647', 2147483647],
  ])('%p は %p として受け付ける', (value, expected) => {
    expect(parseId(value)).toBe(expected);
  });

  test.each([
    [0, '0'],
    ['0', '文字列の 0'],
    [-1, '負数'],
    ['-1', '負数の文字列'],
    [1.5, '小数'],
    ['1.5', '小数の文字列'],
    [2147483648, 'INTEGER の最大値 + 1'],
    ['2147483648', 'INTEGER の最大値 + 1 の文字列'],
    ['99999999999999999999', '非常に大きい数字列'],
    [NaN, 'NaN'],
    [Infinity, 'Infinity'],
    ['', '空文字'],
    [' 1', '前に空白'],
    ['1 ', '後ろに空白'],
    ['1e3', '指数表記'],
    ['0x10', '16 進表記'],
    ['abc', '英字'],
    [null, 'null'],
    [undefined, 'undefined'],
    [true, '真偽値'],
    [{}, 'オブジェクト'],
    [['1'], '配列'],
  ])('%p は不正（%s）として null を返す', (value) => {
    expect(parseId(value)).toBeNull();
  });
});

describe('validateEmployeeName', () => {
  test('前後の空白を除いた名前を返す', () => {
    expect(validateEmployeeName('  山田 太郎  ')).toBe('山田 太郎');
  });

  test('100 文字ちょうどは受け付ける', () => {
    const name = 'あ'.repeat(100);
    expect(validateEmployeeName(name)).toBe(name);
  });

  test('サロゲートペアも 1 文字として数える（100 文字なら受け付ける）', () => {
    const name = '𠮷'.repeat(100); // UTF-16 では 200 単位だが 100 文字
    expect(validateEmployeeName(name)).toBe(name);
  });

  test('101 文字は 400', () => {
    const err = catchHttpError(() => validateEmployeeName('あ'.repeat(101)));
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('社員名は100文字以内で入力してください');
  });

  test('前後の空白を除いて 100 文字なら受け付ける', () => {
    const name = 'あ'.repeat(100);
    expect(validateEmployeeName(`  ${name}  `)).toBe(name);
  });

  test.each([
    ['', '空文字'],
    ['   ', '半角スペースのみ'],
    ['　　', '全角スペースのみ'],
    ['\t\n', '空白文字のみ'],
    [undefined, '未指定'],
    [null, 'null'],
    [123, '数値'],
    [['山田'], '配列'],
  ])('%p は 400「社員名を入力してください」（%s）', (value) => {
    const err = catchHttpError(() => validateEmployeeName(value));
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('社員名を入力してください');
  });

  test.each([
    ['山田\n太郎', '改行'],
    ['山田\t太郎', 'タブ'],
    ['山田\u0000太郎', 'NULL 文字'],
    ['山田\u001B太郎', 'ESC'],
    ['山田\u007F太郎', 'DEL'],
  ])('名前の途中に制御文字（%s）があれば 400', (value) => {
    const err = catchHttpError(() => validateEmployeeName(value));
    expect(err.status).toBe(400);
    expect(err.message).toBe('社員名に改行・タブなどの制御文字は使えません');
  });
});

describe('validateLeaveReason', () => {
  test.each([
    [undefined, '未指定'],
    [null, 'null'],
    ['', '空文字'],
    ['   ', '空白のみ'],
    ['\n\t', '改行・タブのみ'],
  ])('%p は任意項目なので null を返す（%s）', (value) => {
    expect(validateLeaveReason(value)).toBeNull();
  });

  test('前後の空白を除いた理由を返す', () => {
    expect(validateLeaveReason('  通院のため  ')).toBe('通院のため');
  });

  test('500 文字ちょうどは受け付ける', () => {
    const reason = 'あ'.repeat(500);
    expect(validateLeaveReason(reason)).toBe(reason);
  });

  test('サロゲートペアも 1 文字として数える（500 文字なら受け付ける）', () => {
    const reason = '𠮷'.repeat(500);
    expect(validateLeaveReason(reason)).toBe(reason);
  });

  test('501 文字は 400「500文字以内で入力してください」（要件定義書の文言）', () => {
    const err = catchHttpError(() => validateLeaveReason('あ'.repeat(501)));
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('500文字以内で入力してください');
  });

  test('改行（\\n・\\r\\n）とタブは使える', () => {
    expect(validateLeaveReason('通院\nのため')).toBe('通院\nのため');
    expect(validateLeaveReason('通院\r\nのため')).toBe('通院\r\nのため');
    expect(validateLeaveReason('通院\tのため')).toBe('通院\tのため');
  });

  test.each([
    ['\u0000', 'NULL 文字'],
    ['\u0007', 'BEL'],
    ['\u000B', '垂直タブ'],
    ['\u000C', '改ページ'],
    ['\u001B', 'ESC'],
    ['\u007F', 'DEL'],
  ])('理由の途中に制御文字（%s）があれば 400', (ch) => {
    const err = catchHttpError(() => validateLeaveReason(`通院${ch}のため`));
    expect(err.status).toBe(400);
    expect(err.message).toBe('休暇理由に使えない制御文字が含まれています（改行・タブは使えます）');
  });

  test.each([[123], [true], [{}], [['通院']]])('文字列以外（%p）は 400', (value) => {
    const err = catchHttpError(() => validateLeaveReason(value));
    expect(err.status).toBe(400);
    expect(err.message).toBe('reason は文字列で指定してください');
  });
});
