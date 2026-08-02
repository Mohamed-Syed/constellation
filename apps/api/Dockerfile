# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Constellation core API (NestJS) — multi-stage build.
# Build context is the MONOREPO ROOT (see docker-compose.yml), because the
# api depends on the workspace packages (@constellation/plugin-sdk) and the
# pnpm lockfile lives there.
#
#   base    -> node + pnpm via corepack
#   deps    -> workspace install from the frozen lockfile (cached layer)
#   builder -> build plugin-sdk + api (+ the bundled reference plugin)
#   runtime -> slim, NON-ROOT, entrypoint syncs the DB then boots
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# openssl: required by Prisma's engines. dumb-init: correct PID-1 signal
# handling so `docker compose down` stops the API cleanly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# --- deps: install once, cached until a manifest or the lockfile changes ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json            apps/api/package.json
COPY apps/web/package.json            apps/web/package.json
COPY packages/plugin-sdk/package.json packages/plugin-sdk/package.json
COPY packages/cli/package.json        packages/cli/package.json
COPY plugins/hello-world/package.json plugins/hello-world/package.json
COPY plugins/browser-use/package.json plugins/browser-use/package.json
COPY plugins/graphify/package.json    plugins/graphify/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# NOTE: Prisma 7 cannot even CONSTRUCT a PrismaClient without a driver
# adapter (see apps/api/src/core/INTEGRATION_NOTES_ATLAS.md §5). As of the
# orchestrator's round-2 integration pass, `@prisma/adapter-pg` + `pg` are
# real dependencies in apps/api/package.json and are resolved by the
# frozen-lockfile install above — no extra install step needed here.

# --- builder: compile the SDK, the API, and the reference plugin ----------
FROM base AS builder
COPY --from=deps /app/node_modules                      ./node_modules
COPY --from=deps /app/apps/api/node_modules             ./apps/api/node_modules
COPY --from=deps /app/apps/web/node_modules             ./apps/web/node_modules
COPY --from=deps /app/packages/plugin-sdk/node_modules  ./packages/plugin-sdk/node_modules
COPY --from=deps /app/packages/cli/node_modules         ./packages/cli/node_modules
COPY --from=deps /app/plugins/hello-world/node_modules  ./plugins/hello-world/node_modules
COPY --from=deps /app/plugins/browser-use/node_modules  ./plugins/browser-use/node_modules
COPY --from=deps /app/plugins/graphify/node_modules     ./plugins/graphify/node_modules
COPY . .
# Prisma FIRST: `@prisma/client` is a stub until `prisma generate` writes the
# real client (PrismaClient/Prisma types included). Without this, `nest build`
# fails with TS2305 "has no exported member 'PrismaClient'". Generation needs
# no database — prisma.config.ts falls back to a placeholder URL.
RUN pnpm --filter "@constellation/plugin-sdk..." build \
 && pnpm --filter @constellation/api exec prisma generate
# `...` = "this package and everything it depends on" — and it skips the
# Next.js portal entirely (that's apps/web/Dockerfile).
# NOTE: every plugin the api should be able to INVOKE must be built here.
# The loader reads each plugin's `main` (dist/index.js); a plugin shipped as
# bare source loads with no runtime, so `POST /api/plugins/:id/invoke` fails
# with `declares tool "x" but its runtime implements no invokeTool()` even
# though /api/health reports the plugin as enabled+ok. Verified 2026-08-02:
# browser-use and graphify were missing here and failed exactly that way.
RUN pnpm --filter "@constellation/api..." build \
 && pnpm --filter "@constellation/plugin-hello-world..." build \
 && pnpm --filter "@constellation/plugin-browser-use..." build \
 && pnpm --filter "@constellation/plugin-graphify..." build

# --- runtime --------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    API_PORT=4000 \
    PLUGINS_DIR=/app/plugins

# Entrypoint: bring the database schema up to date, then exec the CMD.
# Written inline so this stays inside round-2 file ownership (Dockerfile
# only — no new files under apps/api/).
RUN set -eux; \
    printf '%s\n' \
      '#!/bin/sh' \
      '# Constellation API entrypoint — DB sync, then boot.' \
      'set -e' \
      'cd /app/apps/api' \
      'if [ -n "${DATABASE_URL:-}" ]; then' \
      '  echo "[entrypoint] prisma generate"' \
      '  npx --no-install prisma generate || echo "[entrypoint] WARN: prisma generate failed; using the client baked at build time"' \
      '  if [ -d prisma/migrations ] && [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then' \
      '    echo "[entrypoint] prisma migrate deploy"' \
      '    npx --no-install prisma migrate deploy' \
      '  else' \
      '    # No migration history exists yet (round 1 shipped the schema but' \
      '    # never ran `migrate dev`). `db push` creates the `core` schema and' \
      '    # its tables so the platform actually connects; swap this for' \
      '    # `migrate deploy` the moment prisma/migrations is committed.' \
      '    echo "[entrypoint] no prisma/migrations found -> prisma db push (schema sync)"' \
      '    # Prisma 7 dropped `--skip-generate` from `db push`; passing it is a' \
      '    # hard error. Generation already happened above, so plain push it is.' \
      '    npx --no-install prisma db push --accept-data-loss' \
      '  fi' \
      'else' \
      '  echo "[entrypoint] DATABASE_URL unset — skipping DB sync (platform boots without persistence)"' \
      'fi' \
      'exec "$@"' \
      > /usr/local/bin/constellation-api-entrypoint; \
    chmod +x /usr/local/bin/constellation-api-entrypoint

# Non-root. node:22 already ships uid/gid 1000 `node`; reuse it rather than
# minting another user. Prisma's CLI writes into the schema dir at runtime,
# hence the ownership transfer on copy.
COPY --from=builder --chown=node:node /app /app

WORKDIR /app/apps/api
USER node
EXPOSE 4000

ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/constellation-api-entrypoint"]
CMD ["node", "dist/main.js"]
