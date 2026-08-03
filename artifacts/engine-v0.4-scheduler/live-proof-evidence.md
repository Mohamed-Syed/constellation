# Engine v0.4 — Scheduler LIVE-PROOF evidence (Polaris, 2026-08-03)

Stack: real local infra (postgres:5432, redis:6380, brain:8791, ollama qwen2.5-coder:7b), api :4001, SCHEDULER_POLL_INTERVAL_MS=5000.

## 1. /api/engine/health — scheduler enabled at boot
{
  "engine": "available",
  "scheduler": { "enabled": true, "pollIntervalMs": 5000, "lastSweepAt": "...", "dueCount": 0, "registeredEvents": 0 }
}
model: { provider:"ollama", model:"qwen2.5-coder:7b", reachable:true }
       + { provider:"openrouter", reachable:false, error:"OPENROUTER_API_KEY is not set" }  ($0/local honored)

## 2. POST /api/engine/schedules — create cron schedule ("* * * * *")
   -> id cmsdhfho70007yofx6ef14ypy, kind:"cron", enabled:true, runCount:0,
      lastRunAt:null, nextRunAt:"2026-08-03T17:08:00.000Z"   (cron parser computed next boundary)

## 3. Auto-enqueue observed (poll loop picked it up at the cron boundary)
   After 17:08:00 UTC: runCount:1, lastRunAt:"2026-08-03T17:08:01.964Z", nextRunAt advanced to 17:09:00.
   A task auto-created by the scheduler: id cmsdhg4rz0009yofx3sjo1ael, title:"scheduled digest",
   createdAt:"2026-08-03T17:08:01.967Z", actorId:null (SYSTEM-authored — no human actor, as designed).

## 4. The auto-enqueued task COMPLETED on Ollama ($0/local)
   GET /api/engine/tasks/cmsdhg4rz0009yofx3sjo1ael
   -> status:"completed", stepCount:1, provider:"ollama", error:null
      steps: [0] done { "result": "scheduler live-proof OK" }
      (correct, grounded done result produced by qwen2.5-coder:7b)

## 5. Recurring behaviour (every-minute cron continued)
   runCount advanced 1 -> 2 (fired again 17:09:00); lastSweepAt kept updating every 5s.

## 6. DELETE + graceful 404
   DELETE /api/engine/schedules/:id -> { deleted: true }
   GET after delete -> HTTP 404  (schedule gone, no further firing)
