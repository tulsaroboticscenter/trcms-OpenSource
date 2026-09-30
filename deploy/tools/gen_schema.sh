#!/usr/bin/env bash
# Regenerate deploy/schema.sql (structure only, no data) from a dev database.
# Run whenever migrations add/alter tables, BEFORE cutting a release, so the
# installer's schema + migration baseline stay in sync.
#   DEV_DB=trcms DEV_USER=root DEV_HOST=127.0.0.1 DEV_PORT=3306 bash deploy/tools/gen_schema.sh
set -euo pipefail
DB="${DEV_DB:-trcms}"; U="${DEV_USER:-root}"; H="${DEV_HOST:-127.0.0.1}"; P="${DEV_PORT:-3306}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/schema.sql"
{
  echo "-- TRCMS database schema (structure only — NO data, NO real member info)."
  echo "-- Loaded by bin/install.php, then the migration baseline, then seed_base.sql."
  echo "-- Collations normalized for MariaDB / MySQL 5.7+. Regenerate: deploy/tools/gen_schema.sh"
  mysqldump -u "$U" -h "$H" -P "$P" --no-data --no-tablespaces --skip-set-charset \
     --default-character-set=utf8mb4 --set-gtid-purged=OFF "$DB" \
   | sed -E 's/utf8mb4_0900_[a-z_]+/utf8mb4_general_ci/g'
} > "$OUT"
echo "Wrote $OUT ($(grep -c 'CREATE TABLE' "$OUT") tables)"
