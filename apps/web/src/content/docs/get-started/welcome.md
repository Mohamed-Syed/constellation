# Welcome to Constellation

> Constellation is an enterprise plugin-platform framework with a durable, 24/7 AI-agent engine built in. This knowledge base teaches you the whole application, end to end — every page, every feature, every setting.

## What Constellation gives you

Behind **one login** you get two cooperating planes:

| Plane | What it is | Where it lives |
|---|---|---|
| **Portal plane** | A single pane of glass for humans: your tools, dashboards, agent operations, and administration. Heavyweight tools (Grafana, Keycloak, Langflow, Open WebUI) are *federated* as tiles behind a reverse proxy — never rewritten. | The web application (default `http://localhost:3005`) |
| **Agent plane** | A production-grade runtime where AI agents run real work autonomously — on demand or on a schedule — using the same tools, with approval gates on anything consequential, durable state that survives restarts, hard cost caps, and a complete audit trail. | The API + engine (default `http://localhost:4001/api`) |

Both planes are extended the same way: **plugins** that conform to the `@constellation/plugin-sdk`. A small, secure core provides auth, RBAC, audit, the plugin loader, and the engine. Everything else is a plugin.

## What you can do, at a glance

- **Run agent tasks** — submit a prompt, pick a model, watch the agent think → act → observe, get a result with real usage and cost.
- **Automate on a schedule** — cron schedules and event-triggered workflows run while you sleep.
- **Orchestrate crews** — one task delegates to child agents, with budget flow-down and result merging.
- **Govern everything** — roles and permissions, approval gates, an immutable audit log, CSV/PDF compliance exports.
- **Watch the platform watch itself** — the Agentic AI Controller scores the platform live and runs safe recovery actions automatically.
- **Learn and extend** — a plugin marketplace with hot-reload, an MCP server *and* client, and the knowledge base you are reading now.

## How this knowledge base is organized

| Section | Covers |
|---|---|
| **Get started** | Signing in, roles, the portal tour, your first task |
| **Agent engine** | Tasks, models, approvals, scheduling, supervision, crews, compare |
| **Automate** | Workflows, the skills marketplace, scheduled reports |
| **Plugins** | The marketplace and the plugin SDK |
| **AI Controller** | The stability score, safe actions, and the autonomous watch |
| **Mesh & federation** | Agent mesh peers and federated tools |
| **Collaborate** | Teams, notifications and channels, the Brain |
| **Govern** | Audit and compliance, MCP, alerts and incident response |
| **Administer** | Administration, the CLI, configuration, deployment, troubleshooting |

> **NOTE:** Every endpoint, permission, default value, and behavior in this knowledge base is documented as the application actually behaves. If something differs from what you see, check the **Troubleshooting** article first, then report it.

## Roles in one sentence

- **Admin** (`admin@constellation.local` by default) — everything: manage users, roles, plugins, mesh, the AI Controller, audit.
- **Viewer** (`viewer@constellation.local` by default) — read-only: can sign in and browse, but management actions return `403 Forbidden`.

See **Sign in & roles** for the full permission catalog.
