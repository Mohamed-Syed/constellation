# Portal tour

> Every page in the portal, what it is for, and how to get there. The portal is a single-pane-of-glass: one login, one navigation, light and dark themes.

## The shell

- **Left sidebar** — all navigation, grouped: *Platform* (Dashboard, Knowledge base, Modules, Workflows, Tools, Engine, Delegations, Skills, Teams, Notifications, Mesh, AI Controller, Brain, Health, Compare) and *Admin* (Admin, Settings). Items are permission-filtered.
- **Top bar** — page title area, the **command palette** (`Ctrl+K` / `⌘K`), theme toggle (light/dark), notifications bell with an unread badge, and your account menu (sign out).
- **Theme** — the toggle switches between the `constellation-light` and `constellation-dark` themes; the choice persists in the session.

## The pages

| Page | Route | Purpose |
|---|---|---|
| Dashboard | `/` | Live summary: modules loaded, healthy/degraded/down counts. **The stat cards are clickable** — click one to filter the module list below to exactly that category. |
| Knowledge base | `/docs` | This documentation — search and read end-to-end usage guides. |
| Modules | `/modules` | Every loaded plugin module with live health. |
| Workflows | `/workflows` | Visual workflow builder: drag to reorder steps, define templated steps, run and watch the trail. |
| Tools | `/tools` | Federated tool tiles (Grafana, Keycloak, Langflow, Open WebUI, and more) behind SSO + reverse proxy. |
| Engine | `/engine` | The agent task console: create tasks, filter by status, watch live step streaming, re-run, cancel, approve/reject, view results. |
| Delegations | `/delegations` | Every crew root as an indented tree with budget flow-down and one-click **Merge results**. |
| Skills | `/skills` | The skill marketplace: install skills (each install becomes a real `skill:<id>` schedule), toggle, uninstall. |
| Teams | `/teams` | Organizations → teams → members with owner/admin/member roles. |
| Notifications | `/notifications` | The durable event feed, mark-read/dismiss/mark-all, plus the admin **Audit** tab with CSV export. |
| Mesh | `/mesh` | Federated agent mesh: peer topology with UP/DOWN/UNKNOWN badges, add-peer form, probe and remove. |
| AI Controller | `/ai-controller` | The platform's live stability score, findings (naming the problem), one-click safe recovery actions, and the autonomous watch card. |
| Brain | `/brain` | The knowledge graph: query grounded answers, remember new notes, browse the graph. |
| Health | `/health` | The live engine dashboard: queue depth, model providers, scheduler, supervisor, alert trail. Auto-refreshes. |
| Compare | `/compare` | Run the same prompt on two or more models side by side: latency, tokens, cost, and quality score. |
| Admin | `/admin` | Admin-only management surface. |
| Settings | `/settings` | Platform settings. |

## Interaction conventions

- **Everything clickable shows a pointer cursor** — buttons, links, stat cards, table rows with actions.
- **Cards with a hover lift** are clickable drill-downs (the dashboard stat cards, the mesh peer cards, the AI Controller watch card).
- **Toasts** (top-right) confirm actions: success (green), info (neutral), error (red). Every action tells you what actually happened.
- **Tables** filter by status tabs with counts (Engine) or severity (AI Controller findings).
- **Live data** pages poll automatically (Health ~5s, Mesh ~10s, AI Controller ~10s) — you do not need to refresh manually.

## Command palette

Press `Ctrl+K` (Windows/Linux) or `⌘K` (macOS) to open the palette: type to jump to any page. It respects the same permission filtering as the sidebar.
