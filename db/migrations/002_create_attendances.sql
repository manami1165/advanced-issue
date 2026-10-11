-- 002: 打刻テーブル（attendances）を作成する
-- 1日1行（社員・日付・出勤時刻・退勤時刻）で打刻を持つ。
-- work_date は出勤した日（日本時間 Asia/Tokyo）をアプリ側で決めて入れる。
-- CREATE TABLE IF NOT EXISTS により、何度実行しても安全。

CREATE TABLE IF NOT EXISTS attendances (
    id          SERIAL      NOT NULL,
    employee_id INTEGER     NOT NULL,
    work_date   DATE        NOT NULL,
    clock_in    TIMESTAMPTZ NOT NULL,
    clock_out   TIMESTAMPTZ NULL,       -- 退勤前は NULL
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT attendances_pkey PRIMARY KEY (id),

    -- 社員削除時は打刻も一緒に削除する
    CONSTRAINT attendances_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,

    -- 1日1行を DB でも保証する（二重出勤打刻は 23505 となり、API で 409 を返す）
    -- 先頭列が employee_id のため、employee_id 単独の検索・月次の絞り込み
    -- （employee_id = $1 AND work_date BETWEEN ...）もこのインデックスで賄える
    CONSTRAINT attendances_employee_id_work_date_key
        UNIQUE (employee_id, work_date),

    -- 出勤より前（または同時刻）に退勤できないようにする
    CONSTRAINT attendances_clock_out_after_clock_in_check
        CHECK (clock_out IS NULL OR clock_out > clock_in)
);
