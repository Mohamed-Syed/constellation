# Crews & delegation

> One agent task can spawn a whole crew. Delegation gives you parent→child task trees, budget flow-down, and one-click result merging — the primitive behind autonomous multi-agent work.

## How delegation works

- **Any existing task can spawn children.** A parent task (even one that failed) can grow a crew — this doubles as a recovery pattern.
- A child **inherits** the actor, team, token budget, and (by default) a reduced max-steps ceiling (parent's `maxSteps − 2`).
- Children run as normal engine tasks; they can themselves spawn children (a tree, not a list).

## Spawning children

From the task detail dialog in **Engine** (the **Delegation** section) or via API:

| Endpoint | Purpose |
|---|---|
| `POST /api/engine/tasks/:id/delegate` | Spawn a child task under a parent |
| `GET /api/engine/tasks/:id/children` | Direct children |
| `GET /api/engine/tasks/:id/tree` | The full descendant tree (depth 4 / 50 nodes) |
| `GET /api/engine/delegations` | Every crew root with its full tree (portal /delegations) |

> **RBAC:** delegation is owner/admin/team-visible; a viewer gets **403**.

## Budget flow-down

The tree view aggregates every descendant's usage onto the root:

- `childCount` — how many direct children,
- `childrenTotalTokens` — all descendants' tokens,
- `childrenCostUSD` — all descendants' cost.

The **Delegations** page shows this per crew root — you see at a glance what the orchestrator spent.

## Merging results

`POST /api/engine/tasks/:id/merge` folds every descendant's `{title, status, result, tokens, cost}` into the parent's `result` as:

```json
{ "summary": "Merged N sub-agent result(s)…", "children": [ … ] }
```

The **Merge results** button on the delegations page (owner-gated) does this in one click.

## MCP

The MCP server exposes `constellation.delegate_task` — an external MCP client can spawn a crew and wait for it (see **MCP**).

## The complete loop

1. Parent task runs, decides it needs help, spawns children (via a tool or the API).
2. Children run (possibly on different models, in parallel via the queue).
3. Budget flows down automatically; the tree shows totals.
4. Operator (or an orchestrating agent) merges results into the parent.
5. Audit records the whole tree.
