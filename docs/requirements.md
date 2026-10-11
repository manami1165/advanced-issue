# 要件定義書

## システム概要

B:勤怠記録アプリを作成する。
社員の出勤・退勤打刻、休暇を記録する。 月次集計ができる

- 利用者: 社員本人（打刻・休暇申請）、管理者（社員の登録・削除、休暇の承認・却下、集計の確認）

## 設計判断

| 論点 | 決めたこと | 理由 |
|------|-----------|------|
| 打刻の持ち方 | 1日1行（社員・日付・出勤時刻・退勤時刻）|シンプルにするため|
| 休暇の単位 | 1申請で1日 | 1行＝1日なので、数えるだけで休暇日数が出せるから |
| 休暇の承認 | ステータスを持つ（申請中・承認・却下）| 実際の会社では上司の承認があるので、その流れに近づけたいから |
| ステータス遷移 | どの状態からどの状態へも変更できる | 承認の取り消しや差し戻しにも対応できるようにするため |
| 欠勤の判定 | 平日で、打刻も承認済みの休暇もない日 | 祝日は考慮しない |
| 休憩 | 考慮しない（退勤 − 出勤 をそのまま勤務時間にする）| 休憩の打刻まで入れると、社員の操作が増えるから |
| 社員削除時 | 打刻と休暇も一緒に削除する（ON DELETE CASCADE）| 社員を消す前に、打刻と休暇を先に消す処理を書かなくて済むから |
| 休暇の種類 | 持たない（理由欄は用意する）| 最低要件に種類の区別がなく、理由欄で足りるから |

## 業務ルール

### 打刻

- 出勤打刻: その日の打刻がまだなければ、現在時刻で出勤を記録する。すでに出勤済みなら 409 を返す
  - メッセージ：すでに出勤済みです　を表示する。
- 退勤打刻: その日に出勤済みで、まだ退勤していなければ、現在時刻で退勤を記録する
  - 出勤していない場合は 400、すでに退勤済みの場合は 409 を返す
  - 出勤していない場合のメッセージ：出勤打刻がありません　を表示する
  - 退勤済みの場合のメッセージ：すでに退勤済みです　を表示する
- 打刻の日付（work_date）は出勤した日（日本時間）とする。日をまたいで退勤しても、出勤した日の勤務として扱う

### 休暇申請

- 同じ社員が同じ日に休暇を2件申請することはできない（409 を返す）
- 申請済みの場合休暇申請ボタンは非活性にする
- メッセージ(万が一突破された場合を考えて)：すでに休暇申請済みです　を表示する
- 休暇理由を記載する欄を作成する(入力は任意)
- 登録時のステータスは「申請中」
- 集計で休暇として数えるのは「承認」の休暇だけ

### 入力チェック

- 社員名: 必須。空やスペースだけは 400 を返す。100文字まで
- 休暇の日付: 平日のみ申請できる（土日は 400 を返す）。過去の日付も申請できる（休んだ日を後から申請するため）
- エラーのときは API が `{ "error": "メッセージ" }` を返し、画面はそのメッセージを表示する

### 当月集計

- 対象期間: 当月1日〜前日（今日はまだ打刻前の可能性があるため欠勤判定に含めない。ただし今日の勤務時間・出勤は含める）
- 勤務時間: 当月の打刻のうち、退勤済みのものについて（退勤 − 出勤）を合計する
- 出勤日数: 打刻がある日の数
- 休暇日数: 承認済みの休暇がある平日の数
- 欠勤日数: 平日のうち、打刻も承認済みの休暇もない日の数
- 同じ日に打刻と承認済みの休暇の両方がある場合は、出勤として数える

## 画面一覧

| 画面 | ファイル | できること |
|------|---------|-----------|
| 社員一覧画面 | `public/index.html` | 社員の一覧表示（当月の勤務時間・出勤・欠勤・休暇の日数も表示）、社員の登録、社員の削除 |
| 打刻・休暇申請画面 | `public/form.html` | 社員を選んで出勤・退勤ボタンで打刻する、休暇を申請する（日付・理由(任意)を入力） |
| 休暇一覧画面 | `public/leaves.html` | 休暇申請の一覧表示（社員で絞り込み）、ステータスの変更 |

## APIエンドポイント一覧

| メソッド | パス | 概要 |
|---------|------|------|
| GET | `/api/employees` | 社員一覧を取得する |
| POST | `/api/employees` | 社員を登録する |
| DELETE | `/api/employees/:id` | 社員を削除する（打刻・休暇も削除される） |
| POST | `/api/attendances/clock-in` | 出勤を打刻する（body: `employee_id`） |
| POST | `/api/attendances/clock-out` | 退勤を打刻する（body: `employee_id`） |
| GET | `/api/attendances?employee_id=&month=YYYY-MM` | 打刻の一覧を取得する |
| GET | `/api/leave-requests?employee_id=` | 休暇申請の一覧を取得する（employee_id は任意） |
| POST | `/api/leave-requests` | 休暇を申請する（body: `employee_id`, `leave_date`, `reason`） |
| PATCH | `/api/leave-requests/:id/status` | 休暇のステータスを変更する（body: `status`） |
| GET | `/api/employees/:id/summary?month=YYYY-MM` | 社員の月次集計を取得する（month を省略したら当月） |

### 共通のエラー

| ステータス | 返す場面 |
|-----------|---------|
| 400 | 入力が不正（必須項目がない、日付や ID の形式が違う、ステータスが規定外など） |
| 404 | 指定した社員・休暇申請が存在しない |
| 409 | 二重の出勤打刻、退勤済みの再退勤、同じ日の休暇の重複申請 |
| 500 | サーバー内部のエラー（詳細はクライアントに返さない） |

## DBテーブル設計

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
| employee_id | INTEGER | NOT NULL, REFERENCES employees(id) ON DELETE CASCADE |
| work_date | DATE | NOT NULL |
| clock_in | TIMESTAMPTZ | NOT NULL |
| clock_out | TIMESTAMPTZ | NULL 可（退勤前は NULL） |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

- UNIQUE (employee_id, work_date) … 1日1行を DB でも保証する
- CHECK (clock_out IS NULL OR clock_out > clock_in) … 出勤より前に退勤できないようにする

### leave_requests（休暇申請）

| カラム | 型 | 制約 |
|-------|----|------|
| id | SERIAL | PRIMARY KEY |
| employee_id | INTEGER | NOT NULL, REFERENCES employees(id) ON DELETE CASCADE |
| leave_date | DATE | NOT NULL |
| reason | TEXT | NULL 可 |
| status | VARCHAR(20) | NOT NULL DEFAULT 'pending', CHECK (status IN ('pending', 'approved', 'rejected')) |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() |

- UNIQUE (employee_id, leave_date) … 同じ日の重複申請を防ぐ

## 状態遷移（休暇申請）

| 値 | 表示名 |
|----|-------|
| pending | 申請中 |
| approved | 承認 |
| rejected | 却下 |

```
          登録
           │
           ▼
       ┌────────┐
       │ 申請中  │
       └────────┘
        ▲  │  ▲  │
        │  ▼  │  ▼
   ┌──────┐  ┌──────┐
   │ 承認  │◀▶│ 却下  │
   └──────┘  └──────┘
```

- 登録したときは必ず「申請中」になる
- 3つの状態は、どの状態からどの状態へも変更できる
- 集計で休暇日数に数えるのは「承認」だけ
