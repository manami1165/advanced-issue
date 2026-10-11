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
  - STEP1: requirements.md に画面・API・テーブル・状態遷移がそろっている
  - STEP2: docs/agents.md と .claude/agents/ に3つのSubagentファイルがある
  - STEP3: psql の `\dt` で employees / attendances / leave_requests の3テーブルが出る
  - STEP4: curl で社員登録が 201、一覧取得が 200 + 配列になる。二重出勤が 409 になる
  - STEP5: `npm run test:coverage` が全件グリーンで、カバレッジ70%以上
  - STEP6: ブラウザで http://localhost:3000 を開き、登録・打刻・休暇申請が一覧に反映される。コンソールにエラーが出ない
- 失敗予測:
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
