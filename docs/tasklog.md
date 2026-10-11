# タスクログ

### 課題C: 勤怠記録アプリ

- ゴール (C-前半): ローカルで基本CRUDとフロントエンドが動く状態
- ゴール (C-後半): 追加機能実装・EC2デプロイ完了
- 分解 (C-前半):
  - STEP1 要件定義書作成
  - STEP2 Subagent定義
  - STEP3 DB設計・マイグレーション
  - STEP4 基本CRUD実装
  - STEP5 テスト追加
  - STEP6 フロントエンド実装
- 検証:
  - 必須、桁数の入力チェックができる
    - 社員名が空なら400、101文字以上なら400になる
  - STEP1: requirements.md に画面・API・テーブル・状態遷移がそろっている
  - STEP2: docs/agents.md と .claude/agents/ に3つのSubagentファイルがある
  - STEP3: psql の `\dt` で employees / attendances / leave_requests の3テーブルが出る
  - STEP4: curl で社員登録が201一覧取得が200 + 配列になる。二重出勤が409になる
  - STEP5: `npm run test:coverage` が全件グリーンで、カバレッジ70%以上
  - STEP6: ブラウザで http://localhost:3000 を開き、登録・打刻・休暇申請が一覧に反映される。コンソールにエラーが出ない
- 失敗予測:
  - 必須、桁数の入力チェックができていない
    - 対処: 空や100文字を超える社員名はエラー（400）にする。
  - パスワードをGitにあげてしまう
    - 対処: .env を .gitignore に入れる。コミット前に git status で .env が入ってないか見る
  - 時刻のズレ: DBがUTCで保存すると、午前0時〜9時の打刻が前の日の work_date になる
    - 対処: work_date は日本時間（Asia/Tokyo）で計算する
  - DBにつながらない: .env の設定漏れや、PostgreSQL が起動していない
    - 対処: 実装の前に psql で接続とテーブルを確かめる
  - 日数がずれる
    - 平日の考え方や境界の判定で日数がずれる
    - 対処: 日付を固定したテストで、出勤・欠勤・休暇の日数を確かめる
  - 二重打刻: ボタンを連打すると同じ日に2回打刻される
    - 対処: DBの UNIQUE 制約で防ぎ、API は 409 を返す。送信中はボタンを押せないようにする
  - なりすまし打刻ができてしまう
    - 対処: ログインは課題の要件にないため今回の範囲外とし、要件定義書に明記した

- 起きたこと:
  - DBにつながらない（失敗予測が当たった）
    - 原因: .env に書いてあった postgres のパスワードが古かった
    - 対処:pg_hba.conf を一時的にtrustにしてパスワードを再設定し、設定を元に戻した
  - マイグレーションで文字コードのエラー
    - 原因:Windowsの psql がSQLファイル（UTF-8）を SJIS として読んでいた
    - 対処: PGCLIENTENCODING=UTF8 を設定して実行した
  - パスワードを .env.exampleに書いてしまった
    - 対処: コミット前に気づいて .env に移した（失敗予測「パスワードをGitにあげてしまう」の手前で止められた）

### 課題C-後半: 追加機能実装
- Agent Teamsへの依頼内容:
Agent Teamを作成して、docs/agent-teams.md の設計書どおりに追加機能を実装してください。
役割は CLAUDE.md の「Agent Team の役割定義」に従ってください。

【先に決めておくAPIの形】
GET /api/employees/:id/monthly-report?year=2026&month=10
→ 200 { "employee_id", "employee_name", "year", "month", "work_minutes", "work_hours", "attendance_days", "late_count" }
- 遅刻: 日本時間で9:00を過ぎて出勤した平日を数える（9:00ちょうどは遅刻ではない。土日は数えない）
- 勤務時間・出勤日数の数え方は既存の月次集計（src/utils/summary.js）と同じ
- year / month が不正なら 400、社員がいなければ 404

【エラーチェック】
- 退勤打刻で、退勤時刻が出勤時刻以前なら 400「退勤時刻が出勤時刻より前です」

【Agent構成】
- Backend Agent: 上のAPIとエラーチェックを src/routes に追加
- Frontend Agent: public/report.html（社員と年月を選んでレポート表示）を作り、全画面のナビにリンクを追加。打刻画面でエラーメッセージを表示
- Test Agent: 追加したAPIとエラーチェックのテスト（遅刻の境目 9:00:00 / 9:00:01、土日を含む）
- Review Agent: セキュリティとコード品質のレビュー

APIの形を先に決めているので、Backend・Frontend・Test は並列で進めてください。
最後に統合して、npm run test:coverage が全件グリーン・70%以上であることを確認してください。
