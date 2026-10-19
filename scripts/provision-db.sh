#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env ]]; then
  echo '.env topilmadi; avval BOT_TOKEN va ADMIN_IDS qiymatlari bilan yarating.' >&2
  exit 1
fi
if grep -q '^DATABASE_URL=' .env; then
  echo 'DATABASE_URL allaqachon mavjud; baza sozlamasini qayta yozmayman.' >&2
  exit 1
fi

role_exists=$(docker exec infra_pgsql psql -U postgres -d postgres -Atc \
  "SELECT 1 FROM pg_roles WHERE rolname='anonimbot'")
db_exists=$(docker exec infra_pgsql psql -U postgres -d postgres -Atc \
  "SELECT 1 FROM pg_database WHERE datname='anonimbot'")
if [[ -n "$role_exists" || -n "$db_exists" ]]; then
  echo 'anonimbot roli yoki bazasi mavjud; qo‘lda tekshirmasdan ustiga yozmayman.' >&2
  exit 1
fi

db_password=$(openssl rand -hex 32)
docker exec -i infra_pgsql psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
CREATE ROLE anonimbot LOGIN PASSWORD '$db_password';
CREATE DATABASE anonimbot OWNER anonimbot;
SQL
printf '\nDATABASE_URL=postgresql://anonimbot:%s@infra_pgsql:5432/anonimbot\n' "$db_password" >> .env
chmod 600 .env
echo 'anonimbot PostgreSQL bazasi va alohida roli yaratildi.'
