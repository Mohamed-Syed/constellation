# Engine v0.5 — Reliability LIVE-PROOF evidence (Polaris, 2026-08-03)

Stack: real local infra (postgres:5432, redis:6380, ollama qwen2.5-coder:7b, api:4001),
ENGINE_SUPERVISOR_INTERVAL_MS=5000, ENGINE_STALE_TASK_MS=25000.

## 1. /api/engine/health at boot — supervision + dead-letter surfaces
  queue.failedTasks: 0
  supervision: { enabled:true, pollIntervalMs:5000, staleThresholdMs:25000,
                 staleFound:0, recovered:0, failedStalled:0 }
  alerts: []

## 2. SUPERVISION — recover a stale running task (resume-once)
  Inserted a task directly in Postgres: stale-run-1, status 'running', updatedAt 2min ago
  (well past the 25s threshold), stallRetried=false, NO active BullMQ job.
  After the 5s supervisor sweep:
    - alerts: engine.task.stale (taskId stale-run-1, detail "122239ms")
             engine.task.recovered (taskId stale-run-1)
    - DB: stallRetried = true  (resume-once marker set; re-enqueued)
  The live worker then genuinely ran it: status -> completed, stepCount:1.
  This proves the supervisor recovered the stale task AND the race guard avoided
  double-running it while it was legitimately working.

## 3. STALLED DEAD-LETTER — a re-stale task (already resumed once) is failed, not re-run
  Inserted stale-run-2: status 'running', updatedAt 2min ago, stallRetried=true (already
  resumed once), no workable job.
  After the sweep:
    - DB: status -> failed, failureClassification -> "stalled",
           error = "stalled after resume attempt -- no progress for 122s"
    - This is the no-infinite-spin guarantee.

## 4. DEAD-LETTER VIEW (GET /api/engine/deadletters)
  Returns the failed task:
    id=stale-run-2 status=failed classification=stalled
    error="stalled after resume attempt -- no progress for 122s"

## 5. ALERT TRAIL (GET /api/engine/alerts) — full sequence, newest first
  engine.task.failed   taskId=stale-run-2 detail=stalled after resume attempt -- no progress for 122s
  engine.task.recovered taskId=stale-run-1 detail=None
  engine.task.stale    taskId=stale-run-1 detail=122239ms

## 6. /api/engine/health after — honest counters
  queue.failedTasks: 1
  supervision: { enabled:true, staleThresholdMs:25000, staleFound:4, recovered:1, failedStalled:1 }
  alerts (in health): 3
