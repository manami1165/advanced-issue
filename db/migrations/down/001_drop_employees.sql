-- 001 のロールバック: 社員テーブルを削除する
-- attendances / leave_requests が employees を参照しているため、
-- 必ず 003 → 002 → 001 の順（参照している側から）に実行する。
-- CASCADE は付けない（依存テーブルが残っていればエラーで止め、意図しない削除を防ぐ）。
DROP TABLE IF EXISTS employees;
