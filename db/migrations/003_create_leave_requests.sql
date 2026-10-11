-- 003: 休暇申請テーブル（leave_requests）を作成する
-- 1申請で1日。登録時のステータスは pending（申請中）。
-- 集計で休暇として数えるのは approved（承認）のみ（アプリ側の集計で判定）。
-- CREATE TABLE IF NOT EXISTS により、何度実行しても安全。

CREATE TABLE IF NOT EXISTS leave_requests (
    id          SERIAL      NOT NULL,
    employee_id INTEGER     NOT NULL,
    leave_date  DATE        NOT NULL,
    reason      TEXT        NULL,       -- 休暇理由（入力は任意）
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- ステータス変更時にアプリ側で NOW() に更新する

    CONSTRAINT leave_requests_pkey PRIMARY KEY (id),

    -- 社員削除時は休暇申請も一緒に削除する
    CONSTRAINT leave_requests_employee_id_fkey
        FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,

    -- 同じ社員の同じ日の重複申請を防ぐ（23505 となり、API で 409 を返す）
    -- 先頭列が employee_id のため、一覧の社員絞り込み（employee_id = $1）や
    -- 月次集計の絞り込みもこのインデックスで賄える
    CONSTRAINT leave_requests_employee_id_leave_date_key
        UNIQUE (employee_id, leave_date),

    -- ステータスは 申請中 / 承認 / 却下 の3種類のみ
    CONSTRAINT leave_requests_status_check
        CHECK (status IN ('pending', 'approved', 'rejected'))
);
