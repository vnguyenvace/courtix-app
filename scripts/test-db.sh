#!/usr/bin/env bash
# Runs the SQL tests against LOCAL Supabase, resetting the database before each file.
# WARNING: wipes all local data.
#
#   ./scripts/test-db.sh                  # every file in supabase/tests (except the plain-Postgres auth stub)
#   ./scripts/test-db.sh locations_test   # one file
set -uo pipefail
cd "$(dirname "$0")/.."

project_id=$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml)
container="supabase_db_${project_id}"
if ! docker ps --format '{{.Names}}' | grep -qx "$container"; then
  echo "Local Supabase isn't running ($container not found). Run: supabase start" >&2
  exit 1
fi

if [ $# -gt 0 ]; then
  files=()
  for name in "$@"; do
    name="${name%.sql}"; name="${name##*/}"
    files+=("supabase/tests/${name}.sql")
  done
else
  files=()
  for f in supabase/tests/*_test.sql; do files+=("$f"); done
fi

out_dir=$(mktemp -d)
failed=()
for f in "${files[@]}"; do
  [ -f "$f" ] || { echo "No such test file: $f" >&2; failed+=("$f"); continue; }
  echo "=== $f"
  echo "    resetting local database..."
  if ! supabase db reset --no-seed >"$out_dir/reset.log" 2>&1; then
    cat "$out_dir/reset.log" >&2
    echo "    database reset failed" >&2
    failed+=("$f"); continue
  fi
  out="$out_dir/$(basename "$f" .sql).out"
  # psql isn't needed on the host: use the one inside the database container.
  # Merge stderr into stdout inside the container: merging on the host (docker exec 2>&1)
  # can interleave the two streams mid-line and break the checker.
  docker exec -i "$container" sh -c 'psql -X -q -v ON_ERROR_STOP=0 -U postgres -d postgres -f - 2>&1' <"$f" >"$out"
  if ./scripts/check-test-output.sh "$f" "$out"; then
    echo "    PASS"
  else
    echo "    FAIL (full output: $out)"
    failed+=("$f")
  fi
done

echo
if [ ${#failed[@]} -eq 0 ]; then
  echo "All ${#files[@]} test file(s) passed."
  rm -rf "$out_dir"
else
  echo "Failed: ${failed[*]}"
  exit 1
fi
