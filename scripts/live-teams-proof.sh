#!/usr/bin/env bash
# Phase 3.0 3.7 — TEAM SPACES live proof. ONE invocation:
#  1) boot api EMBEDDED;
#  2) admin creates a team -> becomes OWNER;
#  3) admin adds viewer@constellation.local as MEMBER;
#  4) admin submits a task WITH teamId;
#  5) viewer: /api/auth/me shows the team, GET /api/teams 200, team task
#     visible via ?teamId=, POST members -> 403 (viewer is not owner/admin).
# Api LEFT RUNNING for the browser phase.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=artifacts/teams
mkdir -p "$OUT"

FREE_PORT='Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true
sleep 1

ENGINE_WORKER_MODE=embedded bash scripts/boot-api-v0.3.sh > "$OUT/api.log" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true; sleep 1; powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true' EXIT

ready=0
for _ in $(seq 1 90); do code=$(curl -s -o NUL -w '%{http_code}' http://localhost:4001/api/health || true); [ "$code" = "200" ] && ready=1 && break; sleep 1; done
[ "$ready" = "1" ] || { echo "API BOOT FAILED"; tail -15 "$OUT/api.log"; exit 1; }
echo "API ready on :4001 (embedded)"

login() { curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | python -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])'; }
ADMIN=$(login admin@constellation.local changeme)
VIEWER=$(login viewer@constellation.local changeme)
[ -n "$ADMIN" ] && [ -n "$VIEWER" ] || { echo "LOGIN FAILED"; exit 1; }
echo "admin + viewer tokens ok"

# 2. admin creates a team
curl -s -X POST http://localhost:4001/api/teams -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"name":"core-team"}' > "$OUT/team-created.json"
TID=$(python -c "import json;print(json.load(open('$OUT/team-created.json'))['team']['id'])")
echo "team created: $TID"
python - "$OUT/team-created.json" <<'PY'
import json,sys
t = json.load(open(sys.argv[1]))["team"]
print(f"  name={t['name']} role={t['role']} orgId={t['orgId']}")
PY

# 3. admin adds viewer
curl -s -X POST http://localhost:4001/api/teams/$TID/members -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"email":"viewer@constellation.local","role":"member"}' > "$OUT/member-added.json"
cat "$OUT/member-added.json"
echo

# 4. admin submits a team task
curl -s -X POST http://localhost:4001/api/engine/tasks -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"team-task-proof\",\"prompt\":\"Reply with exactly this JSON: {\\\"type\\\":\\\"done\\\",\\\"result\\\":\\\"team-ok\\\"}\",\"model\":\"qwen2.5-coder:7b\",\"maxSteps\":3,\"teamId\":\"$TID\"}" > "$OUT/team-task.json"
echo "team task submitted: $(python -c "import json;print(json.load(open('$OUT/team-task.json'))['id'])")"

# 5a. viewer /me carries the team
curl -s http://localhost:4001/api/auth/me -H "Authorization: Bearer $VIEWER" > "$OUT/viewer-me.json"
python - "$OUT/viewer-me.json" <<'PY'
import json,sys
me = json.load(open(sys.argv[1]))
print("viewer /me teams:", me.get("teams"))
PY

# 5b. viewer GET /teams + team detail
curl -s http://localhost:4001/api/teams -H "Authorization: Bearer $VIEWER" > "$OUT/viewer-teams.json"
curl -s http://localhost:4001/api/teams/$TID -H "Authorization: Bearer $VIEWER" > "$OUT/viewer-team-detail.json"
python - "$OUT/viewer-teams.json" "$OUT/viewer-team-detail.json" <<'PY'
import json,sys
teams = json.load(open(sys.argv[1]))["teams"]
detail = json.load(open(sys.argv[2]))
print("viewer teams:", [(t["name"], t["role"]) for t in teams])
print("viewer detail members:", [(m["email"], m["role"]) for m in detail["members"]])
PY

# 5c. viewer sees the team task via ?teamId=
curl -s "http://localhost:4001/api/engine/tasks?teamId=$TID" -H "Authorization: Bearer $VIEWER" > "$OUT/viewer-team-tasks.json"
python - "$OUT/viewer-team-tasks.json" <<'PY'
import json,sys
rows = json.load(open(sys.argv[1]))
print("viewer team tasks:", [(t["id"][:8], t["title"], t.get("teamId") == None and "no-team" or "team") for t in rows])
PY

# 5d. viewer CANNOT manage members (403)
CODE=$(curl -s -o "$OUT/viewer-forbidden.json" -w '%{http_code}' -X POST http://localhost:4001/api/teams/$TID/members -H "Authorization: Bearer $VIEWER" -H 'Content-Type: application/json' -d '{"email":"admin@constellation.local","role":"member"}')
echo "viewer POST members -> HTTP $CODE (expect 403): $(cat "$OUT/viewer-forbidden.json")"

# wait for the team task to complete (usage/cost fields prove the team-scoped run)
for _ in $(seq 1 60); do
  ST=$(curl -s "http://localhost:4001/api/engine/tasks?teamId=$TID" -H "Authorization: Bearer $VIEWER" | python -c 'import json,sys;r=json.load(sys.stdin);print(r[0].get("status") if r else "none")')
  [ "$ST" = "completed" ] && break; sleep 3
done
curl -s "http://localhost:4001/api/engine/tasks?teamId=$TID" -H "Authorization: Bearer $VIEWER" > "$OUT/team-task-final.json"
python - "$OUT/team-task-final.json" <<'PY'
import json,sys
r = json.load(open(sys.argv[1]))
t = r[0]
print(f"team task final: status={t.get('status')} provider={t.get('provider')} tokens={t.get('totalTokens')} cost={t.get('costUSD')}")
PY

echo
echo "API LEFT RUNNING on :4001"
trap - EXIT
exit 0
