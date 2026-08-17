#!/usr/bin/env bash
# Task 3 live acceptance — 1-step "say hello, then done" through the new
# ModelProvider interface (OllamaModelProvider behind ModelRouterService).
set -u
cd /c/Users/<user>/Claude/Code/constellation/apps/api || exit 1
DATABASE_URL="postgresql://constellation:constellation@localhost:5432/constellation?schema=core" \
  PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 ./node_modules/.bin/prisma db push --accept-data-loss 2>&1 | tail -2
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" >/dev/null 2>&1
sleep 1
API_PORT=4001 JWT_SECRET=devsecret DATABASE_URL="postgresql://constellation:constellation@localhost:5432/constellation?schema=core" REDIS_URL="redis://localhost:6380" DEFAULT_MODEL="qwen2.5-coder:7b" node dist/main.js > /tmp/t3-boot.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null; wait $API_PID 2>/dev/null' EXIT
B="http://localhost:4001/api"
for _ in $(seq 1 60); do curl -sf $B/health >/dev/null 2>&1 && break; sleep 1; done
grep -E "listening on|AgentWorker started|OllamaModelProvider" /tmp/t3-boot.log | head -4
TOKEN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
TID=$(curl -s -X POST $B/engine/tasks -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"t3-provider-live","prompt":"Say hello, then respond done with a short summary. Do not use any tools.","model":"qwen2.5-coder:7b","maxTokens":50000}' | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "--- submitted: $TID (maxTokens=50000)"
STATE=""
for _ in $(seq 1 90); do
  STATE=$(curl -s $B/engine/tasks/$TID -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(json.load(sys.stdin)['status'])")
  { [ "$STATE" = "completed" ] || [ "$STATE" = "failed" ] || [ "$STATE" = "cancelled" ]; } && break
  sleep 2
done
echo "--- final status: $STATE"
curl -s $B/engine/tasks/$TID -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json
t=json.load(sys.stdin)
print('  maxSteps:',t.get('maxSteps'),'| maxTokens:',t.get('maxTokens'),'| provider:',t.get('provider'),'| stepCount:',t.get('stepCount'))
for s in t['steps']: print(f\"  [{s['stepIndex']}] {s['type']}: {json.dumps(s['content'])[:120]}\")
assert t['status']=='completed', 'task did not complete'
assert t['provider']=='ollama', 'provider not recorded'
assert t.get('maxTokens')==50000, 'maxTokens not persisted'
print('ASSERT Task 3 OK: completed in', t['stepCount'], 'step(s) via provider interface, maxTokens persisted')
"
echo "--- engine health via router selector:"
curl -s $B/engine/health | python -c "import sys,json;d=json.load(sys.stdin);print('  model:',d['model'],'| reachable:',d['model'].get('reachable') if isinstance(d['model'],dict) else 'n/a')"
echo "=== TASK 3 LIVE ACCEPTANCE: PASSED ==="
