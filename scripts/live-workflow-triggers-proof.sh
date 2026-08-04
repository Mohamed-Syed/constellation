#!/usr/bin/env bash
# Phase 3.0 — WORKFLOW TRIGGER WIRING live proof (Polaris). ONE invocation:
#  1) boot api EMBEDDED with the workflow-trigger build;
#  2) create a CRON-triggered workflow -> an auto-managed ScheduledTask
#     (`workflow:<id>`, workflowId set) appears; at the next minute boundary
#     the scheduler fires it and the WORKFLOW RUNS (not an engine task);
#  3) create an EVENT-triggered workflow on `engine.task.failed` (the
#     autonomous INCIDENT-RESPONSE pattern) -> submit a doomed task -> the
#     failure event fires the workflow, which runs to completion.
# Api LEFT RUNNING for a browser spot-check if desired.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=artifacts/workflow-triggers
mkdir -p "$OUT"

FREE_PORT='Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true
sleep 1

export SCHEDULER_POLL_INTERVAL_MS=5000
ENGINE_WORKER_MODE=embedded bash scripts/boot-api-v0.3.sh > "$OUT/api.log" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true; sleep 1; powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true' EXIT

ready=0
for _ in $(seq 1 90); do code=$(curl -s -o NUL -w '%{http_code}' http://localhost:4001/api/health || true); [ "$code" = "200" ] && ready=1 && break; sleep 1; done
[ "$ready" = "1" ] || { echo "API BOOT FAILED"; tail -15 "$OUT/api.log"; exit 1; }
echo "API ready on :4001 (embedded)"
grep -E "Mapped .*workflows|listening on" "$OUT/api.log" | head -4

TOK=$(curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')
[ -n "$TOK" ] || { echo "LOGIN FAILED"; exit 1; }

# ── 2. CRON-triggered workflow ─────────────────────────────────────────────
curl -s -X POST http://localhost:4001/api/workflows -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"name":"cron-triggered-digest","definition":{"trigger":{"type":"cron","cron":"* * * * *"},"steps":[{"id":"s1","kind":"agent","prompt":"Reply with exactly this JSON: {\"type\":\"done\",\"result\":\"cron-workflow-fired\"}","maxSteps":2}]}}' > "$OUT/workflow-cron.json"
WID=$(python -c "import json;print(json.load(open('$OUT/workflow-cron.json'))['id'])")
echo "cron workflow: $WID"
curl -s http://localhost:4001/api/engine/schedules -H "Authorization: Bearer $TOK" > "$OUT/schedules-after-cron.json"
python - "$OUT/schedules-after-cron.json" "$WID" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
wid = sys.argv[2]
wf = [s for s in d if s.get("name") == f"workflow:{wid}"]
print(f"  auto-managed schedule for workflow: {len(wf)} ->", json.dumps({k: wf[0][k] for k in ("id","name","kind","workflowId","enabled")}) if wf else "MISSING")
PY

# wait for the minute boundary + run completion
echo "waiting for the cron fire + workflow run to complete (up to 4 min)..."
cron_done=0
for _ in $(seq 1 120); do
  R=$(curl -s http://localhost:4001/api/workflows/$WID -H "Authorization: Bearer $TOK")
  N=$(echo "$R" | python -c 'import json,sys;print(len(json.load(sys.stdin).get("runs", [])))')
  if [ "$N" -gt 0 ]; then
    ST=$(echo "$R" | python -c 'import json,sys;d=json.load(sys.stdin);print(d["runs"][0].get("status"))')
    echo "  run #$N status: $ST"
    if [ "$ST" = "completed" ] || [ "$ST" = "failed" ]; then cron_done=1; break; fi
  fi
  sleep 3
done
echo "$R" > "$OUT/workflow-cron-final.json"
[ "$cron_done" = "1" ] || { echo "CRON WORKFLOW RUN DID NOT COMPLETE"; }
python - "$OUT/workflow-cron-final.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for r in d.get("runs", [])[:2]:
    print(f"  cron run: status={r.get('status')} error={r.get('error')} steps={len(r.get('stepsResult') or [])}")
PY

# ── 3. EVENT-triggered workflow — INCIDENT RESPONSE on engine.task.failed ──
curl -s -X POST http://localhost:4001/api/workflows -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"name":"incident-response","definition":{"trigger":{"type":"event","event":"engine.task.failed"},"steps":[{"id":"s1","kind":"agent","prompt":"Reply with exactly this JSON: {\"type\":\"done\",\"result\":\"incident-response-remediated\"}","maxSteps":2}]}}' > "$OUT/workflow-event.json"
EWID=$(python -c "import json;print(json.load(open('$OUT/workflow-event.json'))['id'])")
echo "event workflow (incident response): $EWID (trigger: engine.task.failed)"

curl -s -X POST http://localhost:4001/api/engine/tasks -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"title":"incident-probe","prompt":"must fail","model":"ollama:does-not-exist-incident","maxSteps":2}' > "$OUT/doomed-task.json"
echo "doomed task submitted — the failure must fire the incident-response workflow"
ev_done=0
for _ in $(seq 1 90); do
  R=$(curl -s http://localhost:4001/api/workflows/$EWID -H "Authorization: Bearer $TOK")
  N=$(echo "$R" | python -c 'import json,sys;print(len(json.load(sys.stdin).get("runs", [])))')
  if [ "$N" -gt 0 ]; then
    ST=$(echo "$R" | python -c 'import json,sys;d=json.load(sys.stdin);print(d["runs"][0].get("status"))')
    echo "  incident-response run status: $ST"
    if [ "$ST" = "completed" ] || [ "$ST" = "failed" ]; then ev_done=1; break; fi
  fi
  sleep 3
done
echo "$R" > "$OUT/workflow-event-final.json"
[ "$ev_done" = "1" ] || { echo "EVENT WORKFLOW DID NOT FIRE/COMPLETE"; }
python - "$OUT/workflow-event-final.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for r in d.get("runs", [])[:2]:
    print(f"  event run: status={r.get('status')} error={r.get('error')} steps={len(r.get('stepsResult') or [])}")
PY

echo
echo "API LEFT RUNNING on :4001"
trap - EXIT
exit 0
