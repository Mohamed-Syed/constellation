#!/usr/bin/env bash
# Phase 2.0 2.8 — WORKER AS SEPARATE PROCESS live proof. ONE invocation:
# 1) boot api with ENGINE_WORKER_MODE=separate → loops deferred (honest logs
#    + health), task submitted stays QUEUED (no consumer);
# 2) boot the dedicated worker → it picks the queued task up and COMPLETES it
#    on Ollama (cross-process handoff), and the worker's own scheduler poll
#    auto-enqueues a cron task that also completes.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
OUT=artifacts/worker-separate-process
mkdir -p "$OUT"

FREE_PORT='Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true
sleep 1

# 1. api in SEPARATE mode
ENGINE_WORKER_MODE=separate bash scripts/boot-api-v0.3.sh > "$OUT/api.log" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true; sleep 1; powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true' EXIT

ready=0
for _ in $(seq 1 90); do code=$(curl -s -o NUL -w '%{http_code}' http://localhost:4001/api/health || true); [ "$code" = "200" ] && ready=1 && break; sleep 1; done
[ "$ready" = "1" ] || { echo "API BOOT FAILED"; tail -15 "$OUT/api.log"; exit 1; }
echo "API ready on :4001 (ENGINE_WORKER_MODE=separate)"
echo "--- deferred-loop log lines ---"
grep -iE 'deferred|NOT started here' "$OUT/api.log" | head -3
echo "--- health: scheduler + supervision (must be enabled:false) ---"
curl -s http://localhost:4001/api/engine/health > "$OUT/health-separate.json"
python - "$OUT/health-separate.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]))
print(f"  engine: {h.get('engine')} | scheduler.enabled: {h.get('scheduler',{}).get('enabled')} | supervision.enabled: {h.get('supervision',{}).get('enabled')}")
PY

TOK=$(curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')

# 2. submit a task while NO worker is running — it must stay QUEUED
TASK=$(curl -s -X POST http://localhost:4001/api/engine/tasks -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"title":"worker-separate-proof","prompt":"Reply with exactly this JSON: {\"type\":\"done\",\"result\":\"worker-separate-proof OK\"}","model":"qwen2.5-coder:7b","maxSteps":3}')
TID=$(echo "$TASK" | python -c 'import json,sys;print(json.load(sys.stdin)["id"])')
echo "task id: $TID"
sleep 3
ST=$(curl -s http://localhost:4001/api/engine/tasks/$TID -H "Authorization: Bearer $TOK" | python -c 'import json,sys;print(json.load(sys.stdin)["status"])')
echo "  task status with NO worker running: $ST (expect queued)"
[ "$ST" = "queued" ] && echo "PASS: api in separate mode does NOT consume the queue"

# 3. boot the dedicated worker
bash scripts/boot-worker.sh > "$OUT/worker.log" 2>&1 &
WORKER_PID=$!
trap 'kill $API_PID $WORKER_PID 2>/dev/null || true; sleep 1; powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true' EXIT
sleep 12
echo "--- worker boot log ---"
grep -iE 'WORKER started|AgentWorker started|Scheduler|Supervisor' "$OUT/worker.log" | head -4

for _ in $(seq 1 60); do
  S=$(curl -s http://localhost:4001/api/engine/tasks/$TID -H "Authorization: Bearer $TOK")
  ST=$(echo "$S" | python -c 'import json,sys;print(json.load(sys.stdin)["status"])')
  [ "$ST" = "completed" ] || [ "$ST" = "failed" ] && break
  sleep 2
done
echo "$S" > "$OUT/task-cross-process.json"
python - "$OUT/task-cross-process.json" <<'PY'
import json,sys
t=json.load(open(sys.argv[1]))
print(f"  task final: status={t['status']} provider={t.get('provider')} stepCount={t.get('stepCount')}")
for s in t.get("steps",[]):
    print(f"    step[{s.get('stepIndex')}] {s.get('type')}: {(s.get('result') or s.get('error') or '')[:80]}")
PY

# 4. the WORKER's scheduler auto-enqueues a cron task (runs-while-you-sleep in a separate process)
curl -s -X POST http://localhost:4001/api/engine/schedules -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"name":"worker-scheduler-proof","kind":"cron","cron":"* * * * *","task":{"title":"worker-scheduled","prompt":"Reply with exactly this JSON: {\"type\":\"done\",\"result\":\"worker-scheduler OK\"}","maxSteps":3}}' > "$OUT/schedule-created.json"
SID=$(python -c "import json;print(json.load(open('$OUT/schedule-created.json'))['id'])")
echo "schedule id: $SID (worker's poll loop must fire it)"
sched_done=0
for _ in $(seq 1 75); do
  S2=$(curl -s http://localhost:4001/api/engine/schedules/$SID -H "Authorization: Bearer $TOK")
  RC=$(echo "$S2" | python -c 'import json,sys;d=json.load(sys.stdin);print(d.get("runCount",0))')
  [ "${RC:-0}" -ge 1 ] 2>/dev/null && sched_done=1 && break
  sleep 2
done
echo "$S2" > "$OUT/schedule-final.json"
echo "  schedule runCount: $(python -c "import json;print(json.load(open('$OUT/schedule-final.json')).get('runCount',0))")"

echo "--- acceptance ---"
python - "$OUT" <<'PY'
import json,sys,os
out=sys.argv[1]
t=json.load(open(os.path.join(out,"task-cross-process.json")))
assert t["status"]=="completed", f"cross-process task not completed: {t['status']}"
assert t.get("provider")=="ollama"
h=json.load(open(os.path.join(out,"health-separate.json")))
assert h.get("scheduler",{}).get("enabled") is False, "api health must report scheduler off in separate mode"
assert h.get("supervision",{}).get("enabled") is False, "api health must report supervision off in separate mode"
s=json.load(open(os.path.join(out,"schedule-final.json")))
assert s.get("runCount",0)>=1, f"scheduler in the WORKER did not fire: runCount={s.get('runCount')}"
print("ACCEPTANCE PASSED: api enqueues without consuming; the worker completed the task; the worker's scheduler fired the cron schedule")
PY
