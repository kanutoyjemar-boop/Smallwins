#!/usr/bin/env bash
# Back up a hosted (Railway, Render, VPS...) PostgreSQL database for Small Wins.
#
#   DATABASE_URL="postgresql://user:pass@host:5432/db" ./scripts/backup-hosted.sh
#
# Optional environment variables:
#   BACKUP_DIR   where dumps are written            (default: ./backups)
#   KEEP_DAYS    delete dumps older than N days     (default: 14)
#
# Schedule it daily, e.g. with cron:   0 2 * * *  cd /path/to/app && ./scripts/backup-hosted.sh
# Store a copy somewhere other than the server itself (cloud drive, another machine).
# Dumps contain every user's data: keep them private. They are git-ignored here.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the database you want to back up.}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

command -v pg_dump >/dev/null 2>&1 || { echo "pg_dump not found. Install the PostgreSQL client tools." >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
umask 077
stamp="$(date +%Y%m%d-%H%M%S)"
target="$BACKUP_DIR/selfup-hosted-$stamp.dump"

# Write to a temp name first so a failed run never leaves a broken "latest" backup.
pg_dump --format=custom --no-owner --no-privileges --file="$target.partial" "$DATABASE_URL"
mv "$target.partial" "$target"

# Prove the file is a readable archive before trusting it.
pg_restore --list "$target" >/dev/null
echo "Backup written: $target ($(du -h "$target" | cut -f1))"

find "$BACKUP_DIR" -name 'selfup-hosted-*.dump' -type f -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/Removed old backup: /'
