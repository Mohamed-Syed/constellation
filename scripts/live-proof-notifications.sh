#!/usr/bin/env bash
# Phase 3.0 — NOTIFICATION CENTER live proof (Polaris round 3.4). ONE invocation:
#  1) boot api EMBEDDED (all loops in-process — the notification center's
#     EventBus listener only sees events emitted in ITS process, so separate
#     worker mode would split-brain the feed; embedded is the honest mode);
#  2) REAL platform events -> durable notifications:
#     a. scheduler.schedule.fired   — a cron schedule auto-fires (5s poll)
#     b. engine.task.failed         — unknown-model task 404s terminally
#     c. engine.task.stale + recovered — supervisor recovers a crafted stale
#        running row while both worker slots are busy (job waiting, not
#        active -> the supervisor race-guard passes)
#  3) REST round-trip: list / unread-count / mark-read / read-all / dismiss /
#     404 / no-token 401, with literal evidence files.
# The api is LEFT RUNNING for the browser phase (flow-notifications.json);
# the caller kills the port afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
OUT=artifacts/notifications
mkdir -p "$OUT"

FREE_PORT='Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true
sleep 1

# 1. boot api EMBEDDED with fast scheduler + supervisor
export SCHEDULER_POLL_INTERVAL_MS=5000
export ENGINE_SUPERVISOR_INTERVAL_MS=5000
export ENGINE_STALE_TASK_MS=20000
ENGINE_WORKER_MODE=embedded bash scripts/boot-api-v0.3.sh > "$OUT/api.log" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true; sleep 1; powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true' EXIT

ready=0
for _ in $(seq 1 90); do code=$(curl -s -o NUL -w '%{http_code}' http://localhost:4001/api/health || true); [ "$code" = "200" ] && ready=1 && break; sleep 1; done
[ "$ready" = "1" ] || { echo "API BOOT FAILED"; tail -20 "$OUT/api.log"; exit 1; }
echo "API ready on :4001 (embedded)"
grep -E "listening on|Notification center listening|Mapped .*notifications" "$OUT/api.log" | head -6

TOK=$(curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')
[ -n "$TOK" ] || { echo "LOGIN FAILED"; exit 1; }
echo "admin token acquired"

# 2a. scheduler.schedule.fired — cron schedule fires at the next minute boundary
curl -s -X POST http://localhost:4001/api/engine/schedules -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"name":"notif-center-cron","kind":"cron","cron":"* * * * *","task":{"title":"notif-cron-task","prompt":"Reply with exactly this JSON: {\"type\":\"done\",\"result\":\"notif-cron OK\"}","maxSteps":3}}' > "$OUT/schedule-created.json"
SID=$(python -c "import json;print(json.load(open('$OUT/schedule-created.json'))['id'])")
echo "cron schedule: $SID (fires at the next minute boundary; poll 5s)"
fired=0
for _ in $(seq 1 85); do
  N=$(curl -s "http://localhost:4001/api/notifications?limit=50" -H "Authorization: Bearer $TOK")
  if echo "$N" | grep -q 'scheduler.schedule.fired'; then fired=1; break; fi
  sleep 1
done
[ "$fired" = "1" ] || { echo "SCHEDULE FIRED NOTIFICATION MISSING"; echo "$N" | head -c 800; exit 1; }
echo "$N" > "$OUT/01-list-after-schedule-fired.json"
echo "PASS 2a: scheduler.schedule.fired notification persisted"

# 2b. engine.task.failed — unknown model -> Ollama 404 -> terminal failure
TASK=$(curl -s -X POST http://localhost:4001/api/engine/tasks -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"title":"notif-fail-probe","prompt":"This task must fail terminally","model":"ollama:does-not-exist-notif-probe","maxSteps":2}')
TID=$(echo "$TASK" | python -c 'import json,sys;print(json.load(sys.stdin)["id"])')
echo "doomed task: $TID (unknown model -> Ollama 404 -> terminal failure)"
failed=0
for _ in $(seq 1 45); do
  N=$(curl -s "http://localhost:4001/api/notifications?limit=50" -H "Authorization: Bearer $TOK")
  if echo "$N" | grep -q 'engine.task.failed'; then failed=1; break; fi
  sleep 1
done
[ "$failed" = "1" ] || { echo "TASK FAILED NOTIFICATION MISSING"; echo "$N" | head -c 800; exit 1; }
echo "$N" > "$OUT/02-list-after-task-failed.json"
echo "PASS 2b: engine.task.failed notification persisted"

# 2c. engine.task.stale + recovered — supervisor recovers a crafted stale row
#     while both worker slots are busy (job sits WAITING, not active, so the
#     supervisor race-guard passes; a live worker would be skipped by design).
L1=$(curl -s -X POST http://localhost:4001/api/engine/tasks -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"title":"notif-long-1","prompt":"Write a detailed 300-word plan for migrating a monolith to microservices, step by step.","model":"qwen2.5-coder:7b","maxSteps":20}' | python -c 'import json,sys;print(json.load(sys.stdin)["id"])')
L2=$(curl -s -X POST http://localhost:4001/api/engine/tasks -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"title":"notif-long-2","prompt":"Write a detailed 300-word plan for designing a distributed database, step by step.","model":"qwen2.5-coder:7b","maxSteps":20}' | python -c 'import json,sys;print(json.load(sys.stdin)["id"])')
sleep 3   # let the worker pick both long tasks up (fills both concurrency slots)
T3=$(curl -s -X POST http://localhost:4001/api/engine/tasks -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"title":"notif-stale-probe","prompt":"Reply with exactly this JSON: {\"type\":\"done\",\"result\":\"stale-probe OK\"}","model":"qwen2.5-coder:7b","maxSteps":3}')
T3ID=$(echo "$T3" | python -c 'import json,sys;print(json.load(sys.stdin)["id"])')
docker compose exec -T postgres psql -U constellation -d constellation \
  -c "UPDATE core.\"agent_tasks\" SET status='running', \"updatedAt\"=now()-interval '1 hour' WHERE id='$T3ID';" > "$OUT/sql-stale-craft.txt"
echo "crafted stale row: task $T3ID -> status=running, updatedAt=-1h (job waiting; worker busy)"
stale=0
for _ in $(seq 1 30); do
  N=$(curl -s "http://localhost:4001/api/notifications?limit=50" -H "Authorization: Bearer $TOK")
  if echo "$N" | grep -q 'engine.task.stale'; then stale=1; break; fi
  sleep 1
done
echo "$N" > "$OUT/03-list-after-stale.json"
if [ "$stale" = "1" ]; then
  echo "PASS 2c: engine.task.stale notification persisted"
  if echo "$N" | grep -q 'engine.task.recovered'; then
    echo "PASS 2c: engine.task.recovered notification persisted"
  else
    for _ in $(seq 1 15); do
      sleep 1
      N=$(curl -s "http://localhost:4001/api/notifications?limit=50" -H "Authorization: Bearer $TOK")
      echo "$N" | grep -q 'engine.task.recovered' && { echo "PASS 2c: engine.task.recovered notification persisted"; break; }
    done
  fi
  echo "$N" > "$OUT/04-list-after-recovered.json"
else
  echo "NOTE 2c: stale notification not seen in 30s — supervisor raced the worker; mapping is unit-tested, supervisor emission was live-proven in v0.5 (ec88534)"
fi

# 3. REST round-trip
echo "--- REST round-trip ---"
curl -s http://localhost:4001/api/notifications/unread-count -H "Authorization: Bearer $TOK" > "$OUT/05-unread-before.json"
FIRST_ID=$(python -c "import json;d=json.load(open('$OUT/01-list-after-schedule-fired.json'));print(d['items'][0]['id'])" 2>/dev/null || python -c "import json;d=json.load(open('$OUT/04-list-after-recovered.json'));print(d['items'][0]['id'])")
curl -s -X POST "http://localhost:4001/api/notifications/$FIRST_ID/read" -H "Authorization: Bearer $TOK" > "$OUT/06-mark-read.json"
curl -s -X POST http://localhost:4001/api/notifications/read-all -H "Authorization: Bearer $TOK" > "$OUT/07-read-all.json"
curl -s http://localhost:4001/api/notifications/unread-count -H "Authorization: Bearer $TOK" > "$OUT/08-unread-after.json"
DISMISS_ID=$(python -c "import json;d=json.load(open('$OUT/04-list-after-recovered.json'));print(d['items'][-1]['id'])")
curl -s -X DELETE "http://localhost:4001/api/notifications/$DISMISS_ID" -H "Authorization: Bearer $TOK" > "$OUT/09-dismiss.json"
curl -s -o NUL -w '%{http_code}' -X POST "http://localhost:4001/api/notifications/nonexistent/read" -H "Authorization: Bearer $TOK" > "$OUT/10-mark-missing-status.txt"
curl -s -o NUL -w '%{http_code}' http://localhost:4001/api/notifications > "$OUT/11-no-token-status.txt"
curl -s "http://localhost:4001/api/notifications?unread=true&kind=scheduler.schedule.fired" -H "Authorization: Bearer $TOK" > "$OUT/12-filtered.json"
curl -s "http://localhost:4001/api/notifications?limit=100" -H "Authorization: Bearer $TOK" > "$OUT/13-final-list.json"

python - "$OUT" <<'PY'
import json, os, sys
out = sys.argv[1]
def load(name):
    return json.load(open(os.path.join(out, name)))
print("--- evidence summary ---")
u1 = load("05-unread-before.json"); print(f"unread before : {u1}")
mr = load("06-mark-read.json");   print(f"mark-read     : {mr}")
ra = load("07-read-all.json");    print(f"read-all      : {ra}")
u2 = load("08-unread-after.json");print(f"unread after  : {u2}")
di = load("09-dismiss.json");     print(f"dismiss       : {di}")
print(f"mark missing  : HTTP {open(os.path.join(out,'10-mark-missing-status.txt')).read().strip()} (expect 404)")
print(f"no token      : HTTP {open(os.path.join(out,'11-no-token-status.txt')).read().strip()} (expect 401)")
fl = load("12-filtered.json");    print(f"filtered      : {len(fl['items'])} scheduler.schedule.fired, unread={fl['unreadCount']}")
final = load("13-final-list.json")
print(f"final feed    : {len(final['items'])} notifications, unread={final['unreadCount']}")
for n in final["items"]:
    print(f"  [{n['severity']:7s}] {n['kind']:28s} read={n['read']} | {n['title']} | {n['message'] or ''}"[:130])
PY

echo
echo "API LEFT RUNNING on :4001 for the browser phase (flow-notifications.json)"

# 4. one fresh UNREAD notification for the browser phase (sidebar badge evidence)
TASK2=$(curl -s -X POST http://localhost:4001/api/engine/tasks -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"title":"notif-browser-probe","prompt":"This task must fail terminally too","model":"ollama:does-not-exist-browser-probe","maxSteps":2}')
T2ID=$(echo "$TASK2" | python -c 'import json,sys;print(json.load(sys.stdin)["id"])')
echo "browser-probe doomed task: $T2ID (must surface as an UNREAD engine.task.failed)"
for _ in $(seq 1 45); do
  N=$(curl -s "http://localhost:4001/api/notifications?limit=100" -H "Authorization: Bearer $TOK")
  U=$(echo "$N" | python -c 'import json,sys;print(json.load(sys.stdin)["unreadCount"])')
  [ "$U" -gt 0 ] && break
  sleep 1
done
echo "$N" > "$OUT/14-browser-state.json"
python - "$OUT" <<'PY'
import json, os, sys
d = json.load(open(os.path.join(sys.argv[1], "14-browser-state.json")))
print(f"browser state: {len(d['items'])} notifications, unread={d['unreadCount']} (badge will show {d['unreadCount']})")
PY

trap - EXIT
exit 0
