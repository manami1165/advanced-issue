-- 001: 社員テーブル（employees）を作成する
-- 社員の登録・削除の対象。打刻・休暇申請はこのテーブルを参照する。
-- CREATE TABLE IF NOT EXISTS により、何度実行しても安全。

CREATE TABLE IF NOT EXISTS employees (
    id         SERIAL       NOT NULL,
    name       VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT employees_pkey PRIMARY KEY (id)
);
