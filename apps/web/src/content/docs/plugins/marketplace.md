# Plugin marketplace

> Browse, install, and uninstall capability plugins with **hot-reload** — no API restart needed. Plugins are how Constellation grows.

## What plugins are

Plugins are installable modules built against the `@constellation/plugin-sdk`:

- **Manifest v2** (Zod-validated): identity, version, lifecycle hooks, tools, memory, `requiresApproval` flags.
- Plugins contribute **tools** the agents can call, **nav items** to the portal, **health** checks, and optional **per-plugin Postgres schemas**.
- Built-ins: `browser-use` (browser automation), `graphify` (knowledge graph), `hello-world` (sample).

## The marketplace page

Open **Modules** (`/modules`) or the catalog admin surface:

| Surface | Shows |
|---|---|
| Available | Plugins in the catalog that are not installed |
| Installed | Enabled/disabled state, health, version |

## Installing

1. Open the catalog.
2. Click **Install** on a plugin card.
3. The loader **hot-reloads**: the plugin's tools become available to new agent tasks immediately — no restart.

## Uninstalling

- Marker-gated: the platform refuses to uninstall a plugin that is still in use (the dependency marker), preventing broken states.
- Uninstall removes the plugin from the registry and its tools disappear.

## Enable / disable

Installed plugins can be disabled without uninstalling — disabled plugins stop contributing tools but keep their durable install record.

## Health

Each plugin reports a health state (ok / degraded / down):

- The **Dashboard** cards (Modules loaded / Healthy / Degraded / Down) aggregate exactly this — **click a card to see which modules** make up the count.
- The **AI Controller** folds plugin health into the platform stability score (a degraded plugin is a real finding).
- A plugin that is enabled but unusable (e.g. `browser-use` without credentials, `graphify` without its MCP endpoint) is honestly reported as degraded.

## Where plugin tools run

- Agent tasks: the ReAct loop can call any enabled plugin's tools (subject to the **approval gate**).
- Workflows: tool steps invoke plugin tools directly.
- MCP: some plugins expose their tools through the MCP server.

## RBAC

`core:plugin:manage` (admin) for install/uninstall/enable/disable; browsing is open to signed-in users.
