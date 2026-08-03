#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Constellation — Prisma migration deployment helper (Phase 2.0 "Production
# Foundation").
#
# The core API now ships a COMMITTED migration history under
# apps/api/prisma/migrations/, so production deploys apply schema changes with
# `prisma migrate deploy` (non-destructive, no --accept-data-loss) instead of
# `prisma db push`.
#
# Usage, from anywhere in the repo:
#   bash scripts/prisma-migrate.sh            # deploy pending migrations
#   bash scripts/prisma-migrate.sh --status   # report drift (migrate status)
#
# Requires a reachable Postgres and DATABASE_URL (or the compose defaults below).
# This script only ever runs MIGRATE commands — it will not drop or recreate
# tables. For destructive development-only resets, use `prisma migrate reset`
# (NOT db push), which replays the committed history on a clean schema.
# -----------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$REPO_ROOT/apps/api"

# Resolve DATABASE_URL from env, else the compose defaults (see docker-compose.yml).
export DATABASE_URL="${DATABASE_URL:-postgresql://constellation:constellation@localhost:5432/constellation}"

cd "$API_DIR"

cmd="${1:-deploy}"

case "$cmd" in
  deploy)
    "$API_DIR/node_modules/.bin/prisma" migrate deploy
    ;;
  status)
    "$API_DIR/node_modules/.bin/prisma" migrate status
    ;;
  *)
    echo "usage: $0 [deploy|status]" >&2
    exit 2
    ;;
esac
