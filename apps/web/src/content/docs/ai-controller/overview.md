# AI Controller — overview

> The Agentic AI Controller is the platform's own operator: it continuously scores the health of every subsystem, turns problems into concrete findings (naming exactly what is wrong), recommends safe recovery actions, and — in its autonomous mode — runs them by itself. Phase 5.0 of the roadmap.

## The live stability score

Every status call computes a **0–100 score** and a label:

| Label | Score |
|---|---|
| Healthy | ≥ 90 |
| Degraded | 70–89 |
| Unstable | 40–69 |
| Critical | < 40 |

Findings deduct points by severity: **crit −30**, **warn −10**, **info −2**.

## What the controller inspects

| Signal | Finding example |
|---|---|
| Engine availability | `engine-ok` / `engine-down` (crit) |
| Task queue | `queue-down` (crit) — reported even if Redis dies *after* boot |
| Scheduler | `scheduler-down` (warn) |
| Supervisor | `supervisor-down` (warn) |
| Dead letters | `dead-letter` (warn) — "N task(s) failed terminally…" |
| Plugins | `plugins-degraded` (info) — includes load-failed plugins |
| Mesh | `mesh-down` (warn/crit) — **names the actual down peers**, e.g. `Unreachable: dark-site.` |

The score is **deterministic** — the same signals always produce the same score and findings.

## Where to see it

- **Portal**: `/ai-controller` — score hero, clickable severity cards (Findings/Critical/Warnings/Info/Healthy), expandable finding rows, recommended actions, and the autonomous watch card.
- **API**: `GET /api/ai-controller/status` (requires `core:audit:read`).

```json
{
  "generatedAt": "…",
  "score": 78,
  "label": "Degraded",
  "findings": [ { "id": "mesh-down", "severity": "warn", "area": "mesh",
                  "title": "1 mesh peer(s) down",
                  "detail": "Unreachable: dark-site. …" } ],
  "actionsRecommended": ["reprobe-mesh", "re-enqueue-deadletters"],
  "watch": { "enabled": true, "intervalMs": 30000, "lastTickAt": "…",
             "lastScore": 78, "lastLabel": "Degraded",
             "lastAction": "re-enqueue-deadletters", "lastActionAt": "…" }
}
```

## Reads vs. actions — two permissions

| Surface | Permission |
|---|---|
| Read the snapshot (`GET /status`, `GET /actions`) | `core:audit:read` |
| **Run** a recovery action (`POST /act`) | `core:ai-controller:manage` |

A read-only auditor can watch the controller but can never mutate. `platform:admin` implies both.

## Next in this section

- **Safe actions** — the whitelist, what each does, and what happens if you try something not on it.
- **Autonomous watch** — the loop that heals the platform without a human.
