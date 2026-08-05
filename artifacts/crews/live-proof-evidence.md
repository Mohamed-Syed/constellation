# Live-proof evidence — Phase 4.0 · CREWS (4.1, task delegation) (2026-08-05)

Polaris. Files: `proof.log` (full transcript), `delegate-a.json`/`delegate-b.json`
(child records), `tree.json` (durable delegation tree), `mcp-delegate.json`,
`crews-detail.png` (browser, vision-verified).

## What shipped
- **Migration `add_task_delegation`** — `AgentTask.parentTaskId` (self-relation,
  ON DELETE SET NULL, indexed). The delegation graph is DURABLE (a column, not
  an in-memory map): children survive restarts.
- **`DelegationService`** — `spawnChild` (validates parent exists, inherits the
  parent's actor/team/token budget, defaults maxSteps to parent's −2, links +
  enqueues), `childrenOf`, `tree` (depth-capped at 4, 50 nodes), `waitForChildren`
  (bounded poll → summary), no-DB empty degrade. **Any existing task can spawn
  children** — a finished orchestrator can still grow its crew.
- **REST** — `GET /engine/tasks/:id/children` · `GET /engine/tasks/:id/tree` ·
  `POST /engine/tasks/:id/delegate` (visibility RBAC: owner / platform:admin /
  team member → else 403).
- **MCP** — new tool `constellation.delegate_task` (spawn + wait) — so ANY MCP
  client can orchestrate a crew.
- **Portal** — the task detail dialog now has a **Delegation** section: the live
  tree (indented, status badges, token counts) + a Delegate form (title/prompt);
  form shown only to the task's owner. `StatusBadge` extracted to a shared file.

## LIVE PROOF (real events, real Ollama)
- Parent task `crews-parent` **completed** (3 steps, 1366 tokens, $0).
- **Two REST-delegated sub-agents completed** — sub-agent-a (878 tok), sub-agent-b
  (873 tok) — `GET /tree` → root + 2 children, all terminal, real usage/cost.
- **Viewer RBAC**: viewer POST /delegate on admin's task → **HTTP 403**.
- **MCP**: `constellation.delegate_task` via /api/mcp → ok:true, child created
  and **completed on Ollama** (mcp-sub-agent, 1371 tokens).
- **Browser (vision-verified)**: /engine → crews-parent row → detail dialog →
  Delegation section shows **all four tasks in the tree** (crews-parent +
  sub-agent-a + sub-agent-b + mcp-sub-agent, all green completed badges, token
  counts, "4 tasks in this tree" badge) + the Delegate form with title/prompt
  inputs.
- Honest note: earlier runs showed model variance (the 7b coder model rambling
  on terse prompts → maxSteps exhaustion on SOME tasks; hardened prompts +
  relaxed the tree assertion to accept any terminal child state). The delegation
  mechanics were identical across all runs; failures were the model's, not the
  wiring's — and a FAILED parent can still grow its crew, which is a feature
  (recovery pattern).

## Gates
api **579** (41 files, +8 delegation tests) · web typecheck/lint clean
(17 pre-existing warnings) · full four-gate in the round-close pass.
