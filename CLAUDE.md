# 勤怠記録アプリ（課題C テーマB）

- スタック: Node.js + Express 5 + PostgreSQL（pg）、テストは Jest + supertest
- 仕様の正は `docs/requirements.md`。Agent Teams の設計は `docs/agent-teams.md`
- コメントは日本語で書く
- `.env` にはDBのパスワードが入っているので、開かない・表示しない・コミットしない
- 日付は日本時間（Asia/Tokyo）で決める（`src/utils/date.js` を使う）
- 変更後は `npm run test:coverage` が全件グリーン・カバレッジ70%以上であることを確認する

## Agent Team の役割定義

Agent Teams でこのプロジェクトを開発する際は以下の役割を使用すること:

**Backend Agent**: `src/` 配下のサーバーサイドコードを担当
- Express ルートと pg を使った DB 操作のパターンに従う（`src/routes/`、SQL はプレースホルダ `$1` を使う）
- バリデーション・エラーハンドリングを必ず実装する（エラーは `{ "error": "メッセージ" }`、`HttpError` を使う）
- C-前半の backend-architect の注意事項（`docs/agents.md`）を引き継ぐ

**Frontend Agent**: `public/` 配下のクライアントサイドコードを担当
- バニラ HTML/CSS/JavaScript で実装する
- fetch API でバックエンドの REST API と通信する（`public/js/common.js` の共通処理を使う）
- C-前半で作成した既存の public/ のスタイルと整合性を保つ
- ユーザー入力由来の値は `textContent` で描画し、`innerHTML` は使わない（CSP によりインライン script / style も不可）

**Test Agent**: `__tests__/` 配下のテストコードを担当
- バックエンドは Jest + supertest、フロントエンドは Jest + jsdom でテストする
- DB は `jest.mock` で `src/db/pool.js` をモックする。日付は fake timers で固定する

**Review Agent**: 全出力のセキュリティ・コード品質をレビューする
- C-前半の security-auditor の観点（SQLインジェクション・XSS・機密情報）でレビューし、重大度つきで報告する
