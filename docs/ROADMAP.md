# Constellation — Roadmap, Future Enhancements & Known Limitations

> This document states plainly what's built, what's next, and — importantly — what is **not**
> done and where the honest limits are. The project's ethos is transparency over marketing; this
> page reflects that.

## Where we are

Constellation has shipped, live-proven, and documented an unusually complete foundation:

```mermaid
timeline
  title Constellation delivery timeline
  Foundation : Monorepo · Plugin SDK · loader · portal shell
  Platform core : Data layer · Auth/RBAC · Audit · Federation · The Brain
  Agent engine v0–v0.6 : Durable runtime · ReAct loop · approval gate · model router · scheduler · supervisor · dead-letter · hardening
  Phase 2.0 (Production Foundation) : Migrations · metrics · OTel/Tempo · CLI · SSO round-trip · sandboxing · separate worker · Grafana
  Phase 3.0 (Platform as a Product) : /engine UI · marketplace · workflow builder · notifications+channels · multi-model compare · team spaces
  Phase 4.0 (Agentic OS) : Crews · MCP server+client · skill marketplace · semantic retrieval (RAG) · CSV/PDF compliance · alert-triggered incident response
```

**Status:** Phases 2.0 and 3.0 are complete; Phase 4.0 is largely shipped. All of it is
live-proven on real local infrastructure, at **728 tests / 20-of-20 green gates**.

---

## Roadmap — what's next

### Near term (remaining Phase 4.0 backlog)

| Item | Description |
|---|---|
| **Federated agent mesh (4.6)** | ✅ Registry + health prober + topology **SHIPPED 2026-08-05**: `MeshPeer` registry (hash-only API keys), a real prober, `GET /api/mesh/topology`, admin-gated REST, portal `/mesh`. ✅ **Cross-instance task routing SHIPPED**: `POST /api/mesh/peers/:id/route` (sender) + `POST /api/engine/mesh/forward` (receiver, gated by `MESH_ROUTE_API_KEY`); forwards a task to another instance and it enqueues/runs there (LIVE-PROVEN on DeepSeek). Requires a full DB-backed target. Future: locality/capability/load-aware peer selection. |
| **Portal-wide delegation view** | ✅ **SHIPPED**: `GET /api/engine/delegations` + `/delegations` portal page — every agent crew (parent → children) as a live tree with budget flow-down + one-click Merge. |
| **Scheduled report delivery** | ✅ **SHIPPED**: `core/reports` — `POST/GET /api/reports` generates the audit/compliance PDF, writes it to `artifacts/reports/`, and delivers a durable notification + channel dispatch. Cron/skill-style auto-schedule on top is the documented next step. |
| **Team-scoped schedules & workflows** | ✅ **SHIPPED**: schedules (and workflows) carry `teamId`+`createdBy`; the scheduler enforces team membership (403 otherwise) and scopes listing; team roles for finer-grained workflow management remain a follow-up. |
| **Per-user / per-task notification targeting** | ✅ **SHIPPED**: `Notification.recipientId` (migration); list/unread scoped to global OR the caller; reports can target one user (live-proven isolation). Per-task notification *policy* config is a follow-up. |
| **Quality scoring on `/compare`** | ✅ **SHIPPED**: deterministic `scoreQuality()` (0-100 + label) adds an output-quality dimension to the A/B comparison. A semantic LLM-judge tier is the documented follow-up. |
| **In-app Knowledge base** | ✅ **SHIPPED 2026-08-06**: Microsoft-Learn-style end-user docs INSIDE the portal — `/docs` with instant search + section cards, `/docs/[slug]` articles (TOC, breadcrumbs, tables, callouts, prev/next), **32 articles across 9 sections** covering the whole application end to end; zero new dependencies; ships with the web build. |
| **⚙️ Agentic AI Controller (Phase 5.0)** | ✅ **MONITOR + HEAL SHIPPED**: `GET /api/ai-controller/status` (0-100 stability score + findings that NAME down mesh peers + recommended actions), `POST /api/ai-controller/act` (whitelisted safe recovery: `reprobe-mesh`, `re-enqueue-deadletters`, `flush-stale`, `run-deepseek-diagnostic`; dedicated `core:ai-controller:manage` permission), portal `/ai-controller` page, and the **autonomous watch** (`ControllerWatchService`) that scores on a cadence and RUNS safe recovery actions itself (cooldown-guarded, fully audited). Next: the LLM-recommendation tier. |

### Medium term (Production readiness & scale)

- **Enterprise hardening** — append-only audit with a hash chain; a secrets manager + rotation;
  CSRF for cookie mutations; dependency/SBOM/container scanning in CI.
- **Reliability at scale** — per-day (not just per-task) budget/kill-switch; a shared alert store
  for multi-worker deployments; circuit breakers per external dependency.
- **Deployment** — a one-command `constellation up`; Coolify/VPS deploy runbook;
  rehearsed backup/restore; staged path to HA (only if real usage demands it).
- **Plugin ecosystem** — signed manifests; install/upgrade/rollback flows; a remote plugin
  registry beyond the local catalog.
- **Testing depth** — Playwright E2E suite; load/soak baselines; chaos/outage simulations.

### Longer term (the vision)

The north star (from the project's architecture review) is a controlled, observable, recoverable,
model-independent platform where you state an objective; the orchestrator plans it, routes each
step to the most suitable model (local for private data, frontier for hard reasoning), executes
through sandboxed capabilities, checkpoints continuously, escalates to a human at defined gates,
records every action in an append-only audit, remembers what it learned, and keeps working
overnight — with hard caps on cost, time, and blast radius, and a kill-switch you can always reach.

The full strategic roadmap and market analysis informed the design above.

---

## Known limitations

Stated plainly. None of these are hidden; several are deliberate trade-offs for the current
local-first phase.

- **A single Docker Compose host is not high availability.** There is no multi-node replication
  or failover yet. Do not describe or run a single host as HA.
- **The federation overlay ships with development defaults.** Keycloak runs in `start-dev`
  (in-memory H2 — realm config does not survive a restart), with no TLS and `changeme`
  passwords. It must be hardened before any non-local exposure. See [SECURITY.md](../SECURITY.md).
- **Plugin sandboxing is opt-in, and network isolation isn't enforced on all hosts.** Plugins run
  in-process by default; enable `PLUGIN_SANDBOX_MODE=process` for untrusted plugins. Windows has
  no per-process network namespaces, so network isolation there is not enforced.
- **The mid-invoke crash window is at-least-once by design.** If the API is killed *during* a
  tool call (between the pre-invoke checkpoint and the result write), the tool may be re-issued on
  resume. For read tools this is harmless; for write tools, the approval gate + `requiresApproval`
  is the guardrail. A dedicated exactly-once pass is future work, relevant once write-tool
  idempotency matters.
- **Checkpoints rewrite the full message history each step** (O(n²) write volume over a task's
  life). Bounded by `maxSteps` (default 20) so it's not a problem at current scale; a raw-SQL
  append is the noted future optimization.
- **The audit table is immutable by convention, not by storage.** Append-only + hash-chain
  tamper-evidence is on the hardening list.
- **CI has a pipeline defined but limited execution history** as a public project — it becomes a
  first-class gate now that the repo is public.
- **Small local models are variable.** The engine's JSON-action loop works with 7B-class local
  models, but terse prompts can cause a small model to ramble into a max-steps failure. Cloud
  models or larger local models are more reliable for complex tasks; this is model variance, not
  a wiring issue.
- **Backup/restore and load/soak testing are not yet rehearsed.** Do them before production.

---

## Design decisions we deliberately deferred

To keep the load-bearing work (the engine and its guardrails) from being starved by breadth, the
following are intentionally **deferred** (not abandoned): OpenSearch, RabbitMQ, Kubernetes
manifests, Terraform, internationalization, and a full public plugin marketplace. They're
valuable, but the project's discipline is to prove the core value first.

---

*Have a use case or a feature you'd like to see? Open an issue — see [CONTRIBUTING.md](../CONTRIBUTING.md).*
