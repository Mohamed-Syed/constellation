# Troubleshooting & FAQ

> The problems operators actually hit, with the fix. If your symptom is here, this is the answer.

## Portal

### "Application error: a client-side exception has occurred"

Stale `.next` build serving dead chunks. Fix:

```
cd apps/web && rm -rf .next && npx next build && npx next start -p 3005
```

### Login "does nothing" (no request fires)

You opened the portal on a different origin than the API allows — browsers treat `localhost` and `127.0.0.1` as different origins. Open the portal the same way you always do (both are allowed by default), or check `CORS_ORIGINS`.

### Dashboard shows "Live data unavailable"

The page cannot reach the API. Verify the API is up (`curl http://localhost:4001/api/health`) and that the portal's `API_BASE` points at `:4001` (some pages historically used the squatted `:4000` — the fix was to use the shared base).

### Buttons don't show a pointer / feel dead

The global affordance layer sets `cursor: pointer` on interactive elements. If a whole page is dead, the most likely cause is a stale production build — rebuild (see above).

## Engine

### "Reached max steps (N) without completing"

The agent ran out of steps. Raise `maxSteps` for the task, or the platform default via `ENGINE_MAX_STEPS`. Some prompts genuinely need more steps; some models ramble. Use **Compare** to pick a model that finishes.

### Task failed — "DeepSeek returned HTTP 401"

The DeepSeek API key is missing/invalid: set `DEEPSEEK_API_KEY` in `.env` and restart the API. Keys live in `.env` only, never in the repo.

### Model id rejected (unknown model)

Bare ids work (`deepseek-v4-flash`). Composite ids (`deepseek:deepseek-v4-flash`) are normalized automatically — if you still see rejection, the provider's key may be misconfigured (see above).

### Tasks sit in `queued` and never run

The worker is not consuming. Check `ENGINE_WORKER_MODE`: in `separate` mode a worker process must be running. Check Redis (`REDIS_URL` → `:6380`) and the engine health endpoint.

### "Ollama unreachable at http://localhost:11434"

Ollama is stopped on the reference host by design (DeepSeek is the default). Start it only if you need local embeddings (Brain search) or a local model.

## AI Controller

### The score says Degraded/Critical — what do I do?

Read the findings — each names the problem (dead letters, down mesh peers, degraded plugins, disabled scheduler/supervisor). Use the **Recommended** action buttons, or wait: the **autonomous watch** runs the safe recovery actions by itself (cooldown-limited).

### The watch re-enqueued a task and it failed again

Honest behavior: dead letters often fail again (same terminal error). The task returns to the dead-letter list, still visible, and the watch retries on its 15-minute cooldown. Investigate the actual error before re-running endlessly.

### I clicked Run and got a 400 "No safe controller action"

The action is not on the whitelist. The 400 message lists every valid action.

### Viewer gets 403 on the AI Controller

Correct: reads need `core:audit:read`, actions need `core:ai-controller:manage` — the viewer has neither. Sign in as admin.

## Mesh

### Peer stuck "down" with ECONNREFUSED

The peer instance is not reachable at its registered base URL. Start it (or fix the URL), then **Probe**. If it was registered with a `localhost` URL and the peer is remote, re-register with the reachable address.

### Route task → "Database not available"

Cross-instance routing requires a full DB-backed target instance. DB-less peers (health-only) cannot run routed tasks — documented behavior.

## Brain

### `/api/brain/stats` → `available: false`

The Graphify sidecar (or Ollama for embeddings) is down. Check `docker ps` for `constellation-graphify`, and start Ollama if docs-mode indexing/search is needed.

## Notifications

### A channel isn't delivering

Channels are fire-and-forget: a broken webhook never breaks the feed, but it also silently drops. Use the channel's **Test** button to verify delivery, and check per-kind filters (e.g. only `engine.task.failed` was selected).

## General

### Where do secrets live?

`.env` (git-ignored) only. The repo ships zero real keys. If a key is ever pasted into a chat or file, rotate it.

### How do I prove the platform is healthy?

`constellation ops health`, the **Health** page, and the **AI Controller** score — three independent lenses.

### Where is the API documentation?

Swagger/OpenAPI at `http://localhost:4001/api/docs` while the API is running.

### The repo says PRIVATE — can I make it public?

No — the operator has explicitly kept it private. Never change visibility without an explicit instruction.

## FAQ

**Q: Does a task cost real money?**
A: Only if you use paid providers (DeepSeek/OpenRouter). A one-step DeepSeek task costs roughly $0.000025. With Ollama alone the platform is $0.

**Q: Can agents run while I sleep?**
A: Yes — the scheduler runs cron/event schedules 24/7, and the autonomous watch heals the platform itself.

**Q: Can I stop the autonomous watch?**
A: `CONTROLLER_WATCH_ENABLED=off` (manual surfaces still work).

**Q: Is anything exactly-once?**
A: Tool calls behind the approval gate run exactly once. The engine's step model is at-least-once by design with checkpoint resume.
