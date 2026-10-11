# DB マイグレーション

勤怠記録アプリ用の PostgreSQL テーブル（employees / attendances / leave_requests）を作成する。
テーブル定義は `docs/requirements.md` の「DBテーブル設計」に従う。

## ファイル構成

| ファイル | 内容 |
|---------|------|
| `migrations/001_create_employees.sql` | 社員テーブル |
| `migrations/002_create_attendances.sql` | 打刻テーブル（UNIQUE (employee_id, work_date)、退勤 > 出勤 の CHECK） |
| `migrations/003_create_leave_requests.sql` | 休暇申請テーブル（UNIQUE (employee_id, leave_date)、status の CHECK） |
| `migrations/down/*.sql` | ロールバック用の DROP 文（003 → 002 → 001 の順に実行する） |
| `migrate.sh` | 上記を番号順にまとめて実行するスクリプト |

- すべて `CREATE TABLE IF NOT EXISTS` なので、何度実行しても安全。
- attendances / leave_requests は employees を参照するため、必ず 001 → 002 → 003 の順に実行する。

## 事前準備

1. PostgreSQL が起動していることを確認する。

   ```bash
   pg_isready -h localhost -p 5432
   ```

2. プロジェクトルートで `.env.example` をコピーして `.env` を作り、値を書き換える（`.env` は Git に入らない）。

   ```bash
   cp .env.example .env
   ```

   `migrate.sh` は `.env` をシェルスクリプトとして読み込む（source する）。
   値に `$` や `` ` `` などの記号を含む場合（パスワードなど）は、展開されないようにシングルクォートで囲む。

   ```bash
   DB_PASSWORD='pa$$w`rd'
   ```

3. 開発用 DB を作成する（初回のみ）。パスワードは対話プロンプトで入力する。

   ```bash
   createdb -h localhost -U postgres attendance_app
   ```

## 適用方法

### A. スクリプトで実行する（推奨）

`.env` の DB_* を読み込み、`migrations/*.sql` を番号順に適用する。

```bash
bash db/migrate.sh          # 適用
bash db/migrate.sh down     # ロールバック（全テーブル削除。データも消えるので注意）
```

### B. psql で手動実行する

パスワードはコマンドに書かず、プロンプトで入力する。
SQL ファイルは UTF-8 なので、Windows では先に `export PGCLIENTENCODING=UTF8` を実行しておく（しないと SJIS として読まれてエラーになる）。


```bash
psql -h localhost -U postgres -d attendance_app -v ON_ERROR_STOP=1 \
  -f db/migrations/001_create_employees.sql \
  -f db/migrations/002_create_attendances.sql \
  -f db/migrations/003_create_leave_requests.sql
```

ロールバック（逆順で実行する）:

```bash
psql -h localhost -U postgres -d attendance_app -v ON_ERROR_STOP=1 \
  -f db/migrations/down/003_drop_leave_requests.sql \
  -f db/migrations/down/002_drop_attendances.sql \
  -f db/migrations/down/001_drop_employees.sql
```

## 確認方法

```bash
psql -h localhost -U postgres -d attendance_app -c "\dt"
psql -h localhost -U postgres -d attendance_app -c "\d attendances"
psql -h localhost -U postgres -d attendance_app -c "\d leave_requests"
```

`\dt` で employees / attendances / leave_requests の3テーブルが表示されれば OK。

## 注意

- `migrate.sh` は既存テーブルの定義変更（ALTER）は行わない。定義を変えたい場合は新しい番号のファイル（004_...）を追加する。
- work_date / leave_date は DATE 型。日付は日本時間（Asia/Tokyo）でアプリ側が決めて入れる。
