# Constellation

> **Enterprise plugin platform framework.** A small, secure core provides auth,
> RBAC, navigation, settings, and a plugin loader. Everything else — every
> imported GitHub repository — is an installable **module**. Drop it in, the core
> discovers it. No core rewrites, ever.
>
> _Codename `constellation` (placeholder — rename freely). Separate from the
> Looper project._

## Why this exists

Instead of one monolith, Constellation is two cooperating planes:

- **Portal plane** — one SSO login, one navigation, one look. Heavyweight tools
  (Grafana, Langflow, Open WebUI, Coolify, …) are federated as modules behind a
  reverse proxy + shared identity, not rewritten.
- **Agent plane** — the 24/7 automation brain. Capabilities (browser automation,
  code agents, knowledge graph, review) are called as tools.

Both are extended the same way: **plugins that conform to `@constellation/plugin-sdk`**.

## Monorepo layout

```
constellation/
├── apps/
│   ├── api/            # NestJS core: bootstrap, config, plugin loader, health
│   └── web/            # Next.js portal (single pane of glass)
├── packages/
│   └── plugin-sdk/     # THE contract: manifest schema, Plugin interface, context, permissions
├── plugins/
│   └── hello-world/    # reference plugin
└── docs/
    └── MASTER_PLAN.md  # single source of truth — read this to resume
```

## Quick start (local, $0)

```bash
corepack enable
pnpm install
pnpm build                 # builds the SDK + plugins
pnpm --filter @constellation/api dev     # core API → http://localhost:4000/api
pnpm --filter @constellation/web dev     # portal   → http://localhost:3000
```

Health: `GET http://localhost:4000/api/health` · OpenAPI: `/api/docs` ·
Modules: `GET /api/plugins`.

## Tech

TypeScript · NestJS · Next.js (App Router) · TailwindCSS · Zod · pnpm + Turborepo.
PostgreSQL / Redis / OpenSearch / RabbitMQ and SSO arrive in later phases (see the plan).

See [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md) for architecture, decisions, roadmap, and the active task split.
