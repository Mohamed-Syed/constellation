#!/usr/bin/env bash
# Task 2 live acceptance — approval gate. Real Ollama + Postgres + Redis:6380, api:4001.
set -u
cd /c/Users/syed.mohamed/Claude/Code/constellation/apps/api || exit 1

export API_PORT=4001
export JWT_SECRET=devsecret
export DATABASE_URL="postgresql://constellation:constellation@localhost:5432/constellation?schema=core"
export REDIS_URL="redis://localhost:6380"
export DEFAULT_MODEL="qwen2.5-coder:7b"
export ENGINE_REQUIRE_APPROVAL_ALL="false"
B="http://localhost:4001/api"

# 1. Free the port + boot
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" >/dev/null 2>&1
sleep 1
node dist/main.js > /tmp/t2-boot.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null; wait $API_PID 2>/dev/null' EXIT

for _ in $(seq 1 60); do curl -sf $B/health >/dev/null 2>&1 && break; sleep 1; done
echo "--- boot log (routes of interest) ---"
grep -E "listening on|approve|reject|AgentWorker started|engine" /tmp/t2-boot.log | head -10

# 2. Login
TOKEN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
echo "--- token: ${TOKEN:0:24}..."

# 3. Submit task that MUST call browser.act (requiresApproval:true in manifest v2)
PROMPT='You must call the tool browser.act exactly once using plugin "browser-use" with args {"action":"click","selector":"#signup"}. Wait for the tool result, then reply done with a short summary.'
TID=$(curl -s -X POST $B/engine/tasks -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"t2-approve-live\",\"prompt\":$(python -c "import json,sys;print(json.dumps(sys.argv[1]))" "$PROMPT"),\"model\":\"qwen2.5-coder:7b\"}" | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "--- submitted task: $TID"

# 4. Poll until PAUSED (or timeout)
STATE=""
for _ in $(seq 1 90); do
  STATE=$(curl -s $B/engine/tasks/$TID -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(json.load(sys.stdin)['status'])")
  [ "$STATE" = "paused" ] && break
  sleep 2
done
echo "--- status after poll: $STATE"
echo "--- steps at pause:"
curl -s $B/engine/tasks/$TID -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json
t=json.load(sys.stdin)
for s in t['steps']: print(f\"  [{s['stepIndex']}] {s['type']}: {json.dumps(s['content'])}\")
types=[s['type'] for s in t['steps']]
assert t['status']=='paused', 'expected paused'
assert 'pending_approval' in types, 'no pending_approval step'
assert 'tool_result' not in types, 'TOOL RAN BEFORE APPROVAL'
print('ASSERT pause-state OK: paused + pending_approval step + NO tool_result')
"
TID1=$TID

# 5. Approve -> must resume, run tool EXACTLY once, then complete
echo "--- POST approve"
curl -s -X POST $B/engine/tasks/$TID/approve -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print('  approve ->',json.load(sys.stdin))"
STATE=""
for _ in $(seq 1 120); do
  STATE=$(curl -s $B/engine/tasks/$TID -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(json.load(sys.stdin)['status'])")
  { [ "$STATE" = "completed" ] || [ "$STATE" = "failed" ] || [ "$STATE" = "cancelled" ]; } && break
  sleep 2
done
echo "--- final status: $STATE"
echo "--- steps after approve:"
curl -s $B/engine/tasks/$TID -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json
t=json.load(sys.stdin)
for s in t['steps']: print(f\"  [{s['stepIndex']}] {s['type']}: {json.dumps(s['content'])}\")
types=[s['type'] for s in t['steps']]
assert types.count('tool_result')==1, 'tool ran != once'
idx=[s['stepIndex'] for s in t['steps']]
assert len(idx)==len(set(idx)), 'duplicate stepIndex!'
print('ASSERT approve OK: tool_result exactly once, unique ascending stepIndex')
"
echo "--- audit trail (engine.task.*):"
curl -s $B/audit -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json
for a in json.load(sys.stdin):
    if 'engine.task' in str(a.get('action','')): print(' ',a.get('action'),a.get('target'))
"
TID2=$(curl -s -X POST $B/engine/tasks -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"t2-reject-live\",\"prompt\":$(python -c "import json,sys;print(json.dumps(sys.argv[1]))" "$PROMPT"),\"model\":\"qwen2.5-coder:7b\"}" | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "--- submitted reject-task: $TID2"
STATE=""
for _ in $(seq 1 90); do
  STATE=$(curl -s $B/engine/tasks/$TID2 -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(json.load(sys.stdin)['status'])")
  [ "$STATE" = "paused" ] && break
  sleep 2
done
echo "--- reject-task status: $STATE"
echo "--- POST reject"
curl -s -X POST $B/engine/tasks/$TID2/reject -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print('  reject ->',json.load(sys.stdin))"
curl -s $B/engine/tasks/$TID2 -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json
t=json.load(sys.stdin)
print('  status:',t['status'],'| error:',t.get('error'))
assert t['status']=='failed' and 'Rejected by' in (t.get('error') or ''), 'reject not honoured'
print('ASSERT reject OK: failed with \"Rejected by <user>\"')
"
echo "--- audit trail 2 (engine.task.*):"
curl -s $B/audit -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json
for a in json.load(sys.stdin):
    if 'engine.task' in str(a.get('action','')): print(' ',a.get('action'),a.get('target'))
"
echo "=== TASK 2 LIVE ACCEPTANCE: ALL ASSERTIONS PASSED ==="
