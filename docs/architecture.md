# アーキテクチャ

勤怠記録アプリ（課題C テーマB）の構成をまとめる。仕様の詳細（業務ルール・メッセージ）は `docs/requirements.md` を正とする。

## 全体構成

```
ブラウザ
  │  http://<EC2のIP>（80番）
  ▼
Nginx（リバースプロキシ）
  │  http://127.0.0.1:3000
  ▼
Node.js + Express 5（pm2 で常駐。プロセス名 app）
  ├─ public/ の HTML / CSS / JS を配信
  └─ /api/* の REST API
        │  pg（プレースホルダ $1, $2 …）
        ▼
PostgreSQL（同じ EC2 上。localhost:5432、DB 名 attendance_app）
```

- アプリは `127.0.0.1` でだけ待ち受け、外からは Nginx 経由でしか届かない
- DB の接続情報は `.env`（Git には入れない）から読む

## 技術スタック

| 分類 | 使っているもの |
|------|---------------|
| サーバー | Node.js 24 / Express 5 / helmet（CSP などのセキュリティヘッダー） |
| DB | PostgreSQL / pg |
| 画面 | バニラ HTML / CSS / JavaScript（fetch API） |
| テスト | Jest / supertest（DB は `jest.mock` でモック） |
| 本番 | AWS EC2（Ubuntu）/ Nginx / pm2 |
| CI/CD | GitHub Actions |

## ディレクトリ構成

```
src/
  index.js                 サーバー起動（listen とシャットダウン処理）
  app.js                   Express 本体（helmet・静的配信・ルート登録・エラーハンドラ）
  db/pool.js               PostgreSQL の接続プール
  routes/
    employees.js           社員・月次集計・月次レポート
    attendances.js         出勤・退勤の打刻
    leaveRequests.js       休暇申請
  middleware/
    errorHandler.js        エラーを { "error": "メッセージ" } に変換（DB の制約違反 → 400 / 404 / 409）
  utils/
    date.js                日本時間（Asia/Tokyo）の日付計算
    summary.js             月次集計の計算（勤務時間・出勤・休暇・欠勤）
    report.js              月次レポートの計算（遅刻の判定）
    validation.js          入力チェック・HttpError
public/
  index.html               社員一覧
  form.html                打刻・休暇申請
  leaves.html              休暇一覧
  report.html              月次レポート（C-後半で追加）
  js/common.js             API 呼び出しなどの共通処理
db/migrations/             テーブル作成の SQL（db/migrate.sh でまとめて実行）
__tests__/                 テスト
.github/workflows/         CI（ci.yml）・CD（deploy.yml）
```

## APIエンドポイント一覧

| メソッド | パス | 概要 |
|---------|------|------|
| GET | `/api/employees` | 社員一覧 |
| POST | `/api/employees` | 社員登録（body: `name`） |
| DELETE | `/api/employees/:id` | 社員削除（打刻・休暇も削除） |
| GET | `/api/employees/:id/summary?month=YYYY-MM` | 月次集計（省略時は当月） |
| GET | `/api/employees/:id/monthly-report?year=YYYY&month=M` | 月次レポート（勤務時間・出勤日数・遅刻回数）**C-後半で追加** |
| POST | `/api/attendances/clock-in` | 出勤打刻（body: `employee_id`） |
| POST | `/api/attendances/clock-out` | 退勤打刻（body: `employee_id`）。退勤時刻が出勤時刻以前なら 400 **C-後半で追加** |
| GET | `/api/attendances?employee_id=&month=YYYY-MM` | 打刻一覧 |
| GET | `/api/leave-requests?employee_id=` | 休暇申請一覧（employee_id は任意） |
| POST | `/api/leave-requests` | 休暇申請（body: `employee_id`, `leave_date`, `reason`） |
| PATCH | `/api/leave-requests/:id/status` | ステータス変更（body: `status`） |

### 月次レポートのレスポンス

```json
{
  "employee_id": 1,
  "employee_name": "山田 太郎",
  "year": 2026,
  "month": 10,
  "work_minutes": 9600,
  "work_hours": 160,
  "attendance_days": 20,
  "late_count": 2
}
```

- 遅刻: 日本時間で 9:00 を過ぎて出勤した平日（9:00:00 ちょうどは遅刻ではない。土日は数えない）
- 勤務時間・出勤日数は月次集計（`summary.js`）と同じ数え方

### エラー

すべて `{ "error": "メッセージ" }` で返す。

| ステータス | 場面 |
|-----------|------|
| 400 | 入力が不正、退勤時刻が出勤時刻以前（CHECK 制約違反 23514） |
| 404 | 社員・休暇申請が存在しない（外部キー違反 23503 を含む） |
| 409 | 二重の出勤打刻、退勤済みの再退勤、同じ日の休暇の重複申請（UNIQUE 違反 23505） |
| 500 | サーバー内部のエラー（詳細はログにだけ出す） |

## DBスキーマ

```
employees 1 ──< attendances      （ON DELETE CASCADE）
employees 1 ──< leave_requests   （ON DELETE CASCADE）
```

### employees（社員）

| カラム | 型 | 制約 |
|-------|----|------|
| id | SERIAL | PRIMARY KEY |
| name | VARCHAR(100) | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

### attendances（打刻）

| カラム | 型 | 制約 |
|-------|----|------|
| id | SERIAL | PRIMARY KEY |
| employee_id | INTEGER | NOT NULL, FK → employees(id) ON DELETE CASCADE |
| work_date | DATE | NOT NULL（出勤した日・日本時間） |
| clock_in | TIMESTAMPTZ | NOT NULL |
| clock_out | TIMESTAMPTZ | NULL 可（退勤前は NULL） |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

- `UNIQUE (employee_id, work_date)` … 1日1行
- `CHECK (clock_out IS NULL OR clock_out > clock_in)` … 退勤は出勤より後（違反は API で 400）

### leave_requests（休暇申請）

| カラム | 型 | 制約 |
|-------|----|------|
| id | SERIAL | PRIMARY KEY |
| employee_id | INTEGER | NOT NULL, FK → employees(id) ON DELETE CASCADE |
| leave_date | DATE | NOT NULL |
| reason | TEXT | NULL 可 |
| status | VARCHAR(20) | NOT NULL DEFAULT 'pending'、CHECK (pending / approved / rejected) |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

- `UNIQUE (employee_id, leave_date)` … 同じ日の重複申請を防ぐ

## デプロイと CI/CD

| ワークフロー | タイミング | 内容 |
|-------------|-----------|------|
| CI（`ci.yml`） | すべてのブランチへの push・main への PR | `npm ci` → `npm run test:coverage`（カバレッジ 70% 未満なら失敗） |
| CD（`deploy.yml`） | main への push | CI が通ったら EC2 に SSH し、`git pull` → `npm ci` → `db/migrate.sh` → `pm2 restart app` |

- GitHub Secrets は `EC2_HOST` / `EC2_USER` / `EC2_KEY` の3つだけ
- DB の接続情報は EC2 上の `~/app/.env` に置き、GitHub には預けない
