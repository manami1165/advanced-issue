#!/usr/bin/env bash
# マイグレーション SQL を番号順に psql で実行するスクリプト
#
# 使い方:
#   bash db/migrate.sh        # db/migrations/*.sql を番号順に適用する
#   bash db/migrate.sh down   # db/migrations/down/*.sql を番号の逆順に適用する（全テーブル削除）
#
# 接続先はプロジェクトルートの .env（DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME）から読む。
# パスワードはコマンドライン引数には渡さず、環境変数 PGPASSWORD 経由で psql に渡す。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# .env があれば読み込む
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.env"
  set +a
fi

# DB_* を psql 用の PG* 環境変数に対応させる（未設定なら psql の既定値に任せる）
[ -n "${DB_HOST:-}" ]     && export PGHOST="$DB_HOST"
[ -n "${DB_PORT:-}" ]     && export PGPORT="$DB_PORT"
[ -n "${DB_USER:-}" ]     && export PGUSER="$DB_USER"
[ -n "${DB_PASSWORD:-}" ] && export PGPASSWORD="$DB_PASSWORD"
[ -n "${DB_NAME:-}" ]     && export PGDATABASE="$DB_NAME"

# SQL ファイルは UTF-8（日本語コメントあり）。Windows の psql は既定で SJIS として読むため明示する
export PGCLIENTENCODING=UTF8

if ! command -v psql >/dev/null 2>&1; then
  echo "エラー: psql が見つかりません。PostgreSQL の bin を PATH に追加してください。" >&2
  exit 1
fi

MODE="${1:-up}"
case "$MODE" in
  up)
    FILES=$(ls "$SCRIPT_DIR"/migrations/*.sql | sort)
    ;;
  down)
    FILES=$(ls "$SCRIPT_DIR"/migrations/down/*.sql | sort -r)
    ;;
  *)
    echo "使い方: bash db/migrate.sh [up|down]" >&2
    exit 1
    ;;
esac

for f in $FILES; do
  echo "==> $(basename "$f")"
  # ON_ERROR_STOP=1: エラーが出たらそこで止める / -1: ファイル単位で1トランザクション
  psql -X -q -v ON_ERROR_STOP=1 -1 -f "$f"
done

echo "完了しました（$MODE）"
