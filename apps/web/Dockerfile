# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Constellation portal (Next.js) — multi-stage build.
# Build context is the MONOREPO ROOT (workspace deps + lockfile live there).
#
# Deliberately a plain `next build` + `next start` — NOT the `standalone`
# output mode, because that would require editing apps/web/next.config.mjs,
# which is outside this module's ownership. Trade-off: a fatter image
# (node_modules ships) for a zero-source-change build. Switch to standalone
# later if image size matters.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# --- deps -----------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json            apps/api/package.json
COPY apps/web/package.json            apps/web/package.json
COPY packages/plugin-sdk/package.json packages/plugin-sdk/package.json
COPY packages/cli/package.json        packages/cli/package.json
COPY plugins/hello-world/package.json plugins/hello-world/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# --- builder --------------------------------------------------------------
FROM base AS builder
# NEXT_PUBLIC_* is inlined into the client bundle at build time, so it has to
# be known here — hence a build arg rather than only a runtime env var.
ARG NEXT_PUBLIC_API_URL=http://api:4000/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
COPY --from=deps /app/node_modules                      ./node_modules
COPY --from=deps /app/apps/api/node_modules             ./apps/api/node_modules
COPY --from=deps /app/apps/web/node_modules             ./apps/web/node_modules
COPY --from=deps /app/packages/plugin-sdk/node_modules  ./packages/plugin-sdk/node_modules
COPY --from=deps /app/packages/cli/node_modules         ./packages/cli/node_modules
COPY --from=deps /app/plugins/hello-world/node_modules  ./plugins/hello-world/node_modules
COPY . .
RUN pnpm --filter "@constellation/web..." build

# --- runtime --------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

# Non-root: reuse the stock uid/gid 1000 `node` user. `.next` must be
# writable by it (Next writes caches there at runtime).
COPY --from=builder --chown=node:node /app /app

WORKDIR /app/apps/web
USER node
EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["pnpm", "start"]
