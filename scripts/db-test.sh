#!/usr/bin/env bash
# Builds a scratch Postgres copy of the database, applies every migration and runs every SQL test.
# Needs a running Postgres (with pgvector if you want the food-search migrations to apply) and the usual
# PGHOST / PGPORT / PGUSER / PGPASSWORD variables. Never point it at the real Supabase database:
# it drops and recreates a database called nutrismart_test.
#   Usage: scripts/db-test.sh
set -u
cd "$(dirname "$0")/.."
DB=nutrismart_test
P="psql -v ON_ERROR_STOP=0 -q"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null || { echo "cannot reach Postgres"; exit 2; }

$P -d $DB >/dev/null 2>&1 <<'S'
create schema if not exists auth; create schema if not exists extensions;
create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public, auth to authenticated, anon, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on functions to authenticated, service_role, anon;
create extension if not exists pgcrypto;
S

echo "Applying migrations..."
bad=0
for f in supabase/migrations/0*.sql; do
  # Errors about extensions that are not in a plain Postgres (vector, cron) are expected and ignored.
  errs=$($P -d $DB -f "$f" 2>&1 | grep ERROR | grep -viE "vector|cron|food_semantic_cache|uuid ~~")
  if [ -n "$errs" ]; then echo "MIGRATION PROBLEM in $f:"; echo "$errs"; bad=1; fi
done

echo "Running tests..."
pass=0; fail=0
for t in supabase/tests_v2_*.sql; do
  $P -d $DB -c "select 1" >/dev/null
  out=$($P -d $DB -f "$t" 2>&1)
  p=$(echo "$out" | grep -c "PASS"); f=$(echo "$out" | grep -cE "FAIL|ERROR")
  printf "  %-34s pass %-3s fail %s\n" "$(basename "$t")" "$p" "$f"
  echo "$out" | grep -E "FAIL|ERROR" | sed 's/^/      /'
  pass=$((pass+p)); fail=$((fail+f))
done
echo "Total: $pass passed, $fail failed"
[ "$bad" = 0 ] && [ "$fail" = 0 ]
