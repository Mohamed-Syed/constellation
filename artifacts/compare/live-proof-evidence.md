# Live-proof evidence — Phase 3.0 item 3.6 · MULTI-MODEL COMPARE (2026-08-04)

Round A of the "finish the roadmap" pass — Polaris. Files: `submit-*.json`,
`task-*.json` (literal task records), `compare-results.png` (browser).

## What shipped
- **Usage/cost now PERSISTED on the task record** (closes the carried v0.3 gap):
  `AgentTask.inputTokens/outputTokens/totalTokens/costUSD` (migration
  `20260804195504_add_task_usage`). `TokenBudget` accumulates input/output/cost;
  the worker persists cumulative usage at all four terminal paths (done,
  max-steps, budget-exhausted, model-error) via `TaskService.markUsage`.
- **Portal `/compare` page** (`core-compare` nav, BarChart3): same prompt on 2+
  models (options from live engine-health providers, reachable-only enabled),
  one engine task per model, side-by-side table + result cards: status,
  latency (startedAt→completedAt), tokens in/out/total, cost, output + copy.
- Tests: +3 (worker usage persistence, TokenBudget accumulation, markUsage).

## LIVE PROOF (embedded boot, real infra: postgres/redis/ollama + deepseek key)
Same prompt, two tasks (literal records in this dir):
| Model | Provider | Status | Latency | Tokens in/out/total | Cost |
|---|---|---|---|---|---|
| qwen2.5-coder:7b | ollama | completed | 51.0s (API run) | 863/79/942 | $0 |
| deepseek-v4-flash | deepseek | completed | 2.3s | 406/49/455 | $1.79e-5 |

Real A/B: local is $0 but 22× slower; cloud costs ≈ $0.000018. Both tasks show
persisted usage — the numbers come from the DB, not estimates.

## REAL BROWSER (CDP, web dev :3005)
`scripts/flow-compare.json`: login → /compare → both model chips selected
(`chipsSelected=2;runDisabled=false`) → Run comparison → both rows completed →
`ROWS(2): ollama · qwen2.5-coder:7b | completed | 16.5s | 869/63 | 932 | $0 ;;
deepseek · deepseek-v4-flash | completed | 2.2s | 408/84 | 492 | $2.80e-5`.
Screenshot `compare-results.png` vision-verified: Compare nav item, model
chips (ollama/openrouter/deepseek), results table + output cards.

## Gates
api 516 (+3) · web typecheck clean, lint 0 errors · full four-gate 20/20 in the
round-close pass. Cloud spend this round ≈ $0.00002.
