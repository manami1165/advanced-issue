// jest の設定
module.exports = {
  // サーバー側のコードなので Node 環境で動かす（jsdom は使わない）
  testEnvironment: 'node',
  // __tests__ 配下の *.test.js だけをテストとして扱う
  testMatch: ['**/__tests__/**/*.test.js'],
  // カバレッジの対象は src 配下のすべての JS
  // ただし src/index.js は app.listen とシグナル処理だけのエントリポイントで、
  // テストでは supertest が app を直接使う（listen しない）ため対象から外す
  collectCoverageFrom: ['src/**/*.js', '!src/index.js'],
  // 課題の基準: すべての指標で 70% 以上
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 70,
      functions: 70,
      lines: 70,
    },
  },
};
