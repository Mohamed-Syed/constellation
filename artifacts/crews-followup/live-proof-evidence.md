# Live-proof evidence — Phase 4.0 · CREWS FOLLOW-UP: budget flow-down + result merging (2026-08-05)

Polaris. Files: `tree.json` (aggregation), `merged.json` (merge payload).

## What shipped
- **Budget flow-down accounting** — `DelegationService.tree()` now aggregates
  every descendant's usage onto the root node: `childCount`,
  `childrenTotalTokens`, `childrenCostUSD`. An orchestrator sees exactly what
  its crew spent, alongside the per-child rows. (Children already inherit the
  parent's token ceiling — maxTokens flows down at spawn.)
- **Result merging** — `DelegationService.mergeResults(parentId)` collects each
  descendant's {title, status, result, tokens, cost} (depth ≤ 2) and writes
  `{summary: "Merged N sub-agent result(s) under <parent>", children: [...]}`
  onto the parent task's `result` — the orchestrator row now carries its crew's
  answers. **REST `POST /engine/tasks/:id/merge`** (owner/admin/team visibility).
- **Portal** — the task-detail Delegation section shows the budget badge
  ("N tasks · X tok · $Y") and an owner-gated **Merge results** button.

## LIVE PROOF (real tasks, real merge)
- Fresh parent `merge-probe-parent` completed → delegated `merge-probe-child`
  (completed, 1347 tokens) → `GET /tree` root shows **childCount: 1,
  childrenTotalTokens: 1347, costUSD: 0** — the flow-down aggregation.
- `POST /merge` → **ok:true**, summary "Merged 1 sub-agent result(s) under
  merge-probe-parent", the child's outcome in the payload — and the parent
  task's own `result` now carries the merged object (verified by re-fetching
  the parent).

## Gates
api **604** (45 files, +2 delegation tests) · web typecheck/lint clean (17
pre-existing warnings) · full four-gate in the round-close pass.
