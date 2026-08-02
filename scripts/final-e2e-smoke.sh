#!/usr/bin/env bash
# FINAL round smoke — end-to-end: submit -> paused -> approve -> tool runs
# EXACTLY ONCE -> task completes, against REAL Ollama + Postgres + Redis:6380.
set -u
cd /c/Users/syed.mohamed/Claude/Code/constellation/apps/api || exit 1
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" >/dev/null 2>&1
sleep 1
API_PORT=4001 JWT_SECRET=devsecret DATABASE_URL="postgresql://constellation:constellation@localhost:5432/constellation?schema=core" REDIS_URL="redis://localhost:6380" DEFAULT_MODEL="qwen2.5-coder:7b" node dist/main.js > /tmp/final-boot.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null; wait $API_PID 2>/dev/null' EXIT
B="http://localhost:4001/api"
for _ in $(seq 1 60); do curl -sf $B/health >/dev/null 2>&1 && break; sleep 1; done
TOKEN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

# Prompt engineered so the model: calls browser.act ONCE (gated), then after
# the tool_result responds done — no more tool calls.
PROMPT='Call the tool browser.act from plugin "browser-use" EXACTLY ONCE with args {"instruction": "click the signup button"}. After you receive the tool result, respond with {"type":"done","result":"finished"} and do NOT call any more tools.'
TID=$(curl -s -X POST $B/engine/tasks -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"final-e2e-smoke\",\"prompt\":$(python -c "import json,sys;print(json.dumps(sys.argv[1]))" "$PROMPT"),\"model\":\"qwen2.5-coder:7b\",\"maxTokens\":20000}" | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "--- submitted: $TID"
STATE=""
for _ in $(seq 1 90); do
  STATE=$(curl -s $B/engine/tasks/$TID -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(json.load(sys.stdin)['status'])")
  [ "$STATE" = "paused" ] && break
  sleep 2
done
echo "--- after submit: status=$STATE (expect paused)"
curl -s $B/engine/tasks/$TID -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json
t=json.load(sys.stdin)
types=[s['type'] for s in t['steps']]
assert t['status']=='paused','not paused'
assert types.count('tool_result')==0,'tool ran before approval'
print('  pause OK — steps:',types)
"
echo "--- POST approve"
curl -s -X POST $B/engine/tasks/$TID/approve -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(' ',json.load(sys.stdin))"
STATE=""
for _ in $(seq 1 120); do
  STATE=$(curl -s $B/engine/tasks/$TID -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(json.load(sys.stdin)['status'])")
  { [ "$STATE" = "completed" ] || [ "$STATE" = "failed" ] || [ "$STATE" = "cancelled" ]; } && break
  sleep 2
done
echo "--- final: status=$STATE"
curl -s $B/engine/tasks/$TID -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json
t=json.load(sys.stdin)
print('  stepCount:',t['stepCount'],'| result:',json.dumps(t.get('result'))[:120])
for s in t['steps']: print(f\"  [{s['stepIndex']}] {s['type']}: {json.dumps(s['content'])[:90]}\")
types=[s['type'] for s in t['steps']]
idx=[s['stepIndex'] for s in t['steps']]
assert t['status']=='completed','did not complete'
assert types.count('tool_result')==1,'tool did not run exactly once'
assert len(idx)==len(set(idx)),'duplicate stepIndex'
print('ASSERT FINAL SMOKE OK: submit->pause->approve->run-once->complete, unique indexes')
"
echo "--- audit trail:"
curl -s $B/audit -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json
for a in json.load(sys.stdin):
    if 'engine.task' in str(a.get('action','')): print(' ',a['action'],a.get('metadata',{}).get('target'))
"
echo "=== FINAL E2E SMOKE: PASSED ==="
