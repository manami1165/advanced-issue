# Subagent定義書

## backend-architect

- 役割: DB設計とバックエンドAPIの実装を担当する
- 担当するタスク:
  - `db/migrations/` のマイグレーションファイル作成（STEP3）
  - `src/routes/` の社員・打刻・休暇申請・月次集計のAPI実装（STEP4）
- 特に注意させること:
  - 日付は日本時間（Asia/Tokyo）で決める。work_date・「当月」・「前日」の計算でUTCを使わない
  - 二重登録（同じ日の出勤打刻・同じ日の休暇申請）は、UNIQUE制約違反（PostgreSQLのエラーコード 23505）を拾って 409 を返す
  - 月次集計は requirements.md のルール（平日のみ・前日まで・承認済みの休暇のみ・打刻と休暇が重なったら出勤）を勝手に変えない

## frontend-developer

- 役割: `public/` 配下の画面を、バニラの HTML / CSS / JavaScript で実装する
- 担当するタスク:
  - `src/index.js` に `express.static('public')` を追加する（STEP6）
  - `public/index.html`（社員一覧）、`public/form.html`（打刻・休暇申請）、`public/leaves.html`（休暇一覧）、`public/style.css` を作る（STEP6）
- 特に注意させること:
  - 打刻・申請の送信中はボタンを無効にして、連打による二重送信を防ぐ
  - エラーのときは API が返す `{ "error": "メッセージ" }` をそのまま画面に表示する。画面側で別の文言を作らない

## security-auditor

- 役割: 実装したコードのセキュリティを確認し、問題と直し方を報告する（コードは書き換えない）
- 担当するタスク:
  - STEP4（API実装）とSTEP6（画面実装）の後にコードを確認する
- 特に注意させること:
  - SQLインジェクション: SQLをプレースホルダ（`$1`, `$2`）で組み立てているか
  - XSS: 社員名や休暇理由など、ユーザーが入力した値を `innerHTML` に入れていないか
  - 機密情報の漏れ: `.env` やDBのパスワードがコードやGitに入っていないか（GitHubにプッシュするため）
