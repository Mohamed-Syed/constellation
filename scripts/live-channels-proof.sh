#!/usr/bin/env bash
# Phase 3.0 — NOTIFICATION CHANNELS live proof. ONE invocation:
#  1) boot api EMBEDDED with the fresh channels build;
#  2) run a LOCAL webhook listener on :9080 (records every POST body);
#  3) configure two channels — generic (ALL events) + slack (failures only);
#  4) trigger REAL events: a completed task (engine.task.completed) and a
#     doomed task (engine.task.failed) — the listener log must show the
#     generic channel getting BOTH and the slack channel only the failure;
#  5) the Test endpoint delivers a test message through one channel.
# Api LEFT RUNNING for the browser phase (flow-channels.json).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=artifacts/channels
mkdir -p "$OUT"

FREE_PORT='Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true
sleep 1

export SCHEDULER_POLL_INTERVAL_MS=5000
ENGINE_WORKER_MODE=embedded bash scripts/boot-api-v0.3.sh > "$OUT/api.log" 2>&1 &
API_PID=$!
python scripts/webhook-listener.py 9080 "$OUT/webhooks.log" > "$OUT/listener.log" 2>&1 &
LISTENER_PID=$!
trap 'kill $API_PID $LISTENER_PID 2>/dev/null || true; sleep 1; powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true' EXIT

ready=0
for _ in $(seq 1 90); do code=$(curl -s -o NUL -w '%{http_code}' http://localhost:4001/api/health || true); [ "$code" = "200" ] && ready=1 && break; sleep 1; done
[ "$ready" = "1" ] || { echo "API BOOT FAILED"; tail -15 "$OUT/api.log"; exit 1; }
echo "API ready on :4001 (embedded); webhook listener on :9080"

TOK=$(curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')
[ -n "$TOK" ] || { echo "LOGIN FAILED"; exit 1; }

# 3. configure two channels
curl -s -X POST http://localhost:4001/api/notifications/channels -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"name":"generic-proof","url":"http://127.0.0.1:9080/hook","format":"generic"}' > "$OUT/channel-generic.json"
curl -s -X POST http://localhost:4001/api/notifications/channels -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"name":"slack-proof","url":"http://127.0.0.1:9080/slack","format":"slack","kinds":["engine.task.failed"]}' > "$OUT/channel-slack.json"
GEN_ID=$(python -c "import json;print(json.load(open('$OUT/channel-generic.json'))['channel']['id'])")
SLACK_ID=$(python -c "import json;print(json.load(open('$OUT/channel-slack.json'))['channel']['id'])")
echo "channels: generic=$GEN_ID slack=$SLACK_ID (failures only)"
curl -s http://localhost:4001/api/notifications/channels -H "Authorization: Bearer $TOK" > "$OUT/channels-list.json"

# 4a. a task that COMPLETES -> engine.task.completed -> generic channel only
T1=$(curl -s -X POST http://localhost:4001/api/engine/tasks -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"title":"channels-complete-probe","prompt":"Reply with exactly this JSON: {\"type\":\"done\",\"result\":\"channels-proof OK\"}","model":"qwen2.5-coder:7b","maxSteps":2}')
T1ID=$(echo "$T1" | python -c 'import json,sys;print(json.load(sys.stdin)["id"])')
for _ in $(seq 1 60); do
  ST=$(curl -s http://localhost:4001/api/engine/tasks/$T1ID -H "Authorization: Bearer $TOK" | python -c 'import json,sys;print(json.load(sys.stdin)["status"])')
  case "$ST" in completed|failed|cancelled) break;; esac
  sleep 2
done
echo "completed probe: $T1ID -> $ST"

# 4b. a task that FAILS terminally -> engine.task.failed -> BOTH channels
T2=$(curl -s -X POST http://localhost:4001/api/engine/tasks -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"title":"channels-fail-probe","prompt":"must fail","model":"ollama:does-not-exist-channels","maxSteps":2}')
T2ID=$(echo "$T2" | python -c 'import json,sys;print(json.load(sys.stdin)["id"])')
for _ in $(seq 1 45); do
  ST2=$(curl -s http://localhost:4001/api/engine/tasks/$T2ID -H "Authorization: Bearer $TOK" | python -c 'import json,sys;print(json.load(sys.stdin)["status"])')
  case "$ST2" in completed|failed|cancelled) break;; esac
  sleep 1
done
echo "doomed probe: $T2ID -> $ST2"

# 5. Test endpoint through the slack channel
curl -s -X POST "http://localhost:4001/api/notifications/channels/$SLACK_ID/test" -H "Authorization: Bearer $TOK" > "$OUT/test-slack.json"
echo "test endpoint: $(cat "$OUT/test-slack.json")"
sleep 1

echo
echo "=== webhook listener log (literal delivery evidence) ==="
cat "$OUT/webhooks.log"
echo
echo "=== counts ==="
echo "  generic path (/hook) hits: $(grep -c ' /hook ' "$OUT/webhooks.log" || true)"
echo "  slack path (/slack) hits: $(grep -c ' /slack ' "$OUT/webhooks.log" || true)"

echo
echo "API LEFT RUNNING on :4001 for the browser phase (flow-channels.json)"
trap - EXIT
exit 0
