#!/usr/bin/env bash
# DeepSeek provider live proof (2026-08-04 round) — ONE invocation:
# free :4001 → boot api with the key from root .env → health check →
# submit a deepseek-v4-flash task → poll to completion → save literal
# evidence to artifacts/deepseek-provider/. Tear-down via the trap.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
OUT=artifacts/deepseek-provider
mkdir -p "$OUT"

FREE_PORT='Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
# 1. free :4001 (single-quoted PowerShell — bash must not expand $_)
powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true
sleep 1

# 2. boot (exports DEEPSEEK_API_KEY from root .env)
bash scripts/boot-api-v0.3.sh > "$OUT/boot.log" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true; sleep 1; powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true' EXIT

# 3. poll readiness (max 90s)
ready=0
for _ in $(seq 1 90); do
  if curl -sf http://localhost:4001/api/health >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != "1" ]; then echo "BOOT FAILED — tail of boot.log:"; tail -20 "$OUT/boot.log"; exit 1; fi
echo "API ready on :4001"

# 4. engine health — must show deepseek reachable:true
curl -s http://localhost:4001/api/engine/health > "$OUT/engine-health.json"
echo "--- engine health providers ---"
python - "$OUT/engine-health.json" <<'PY'
import json,sys
h=json.load(open(sys.argv[1]))
for p in h.get("providers",[]):
    print(f"  {p['provider']}: reachable={p['reachable']} model={p.get('model','')} err={p.get('error','')}")
PY

# 5. login as admin, submit a deepseek task
TOK=$(curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')
TASK=$(curl -s -X POST http://localhost:4001/api/engine/tasks -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"title":"deepseek-v4-flash live proof","prompt":"Reply with exactly this JSON: {\"type\":\"done\",\"result\":\"deepseek live-proof OK\"}","model":"deepseek-v4-flash","maxSteps":3}')
echo "$TASK" > "$OUT/task-submitted.json"
TID=$(echo "$TASK" | python -c 'import json,sys;print(json.load(sys.stdin)["id"])')
echo "task id: $TID (model=deepseek-v4-flash)"

# 6. poll to a terminal state
for _ in $(seq 1 60); do
  S=$(curl -s http://localhost:4001/api/engine/tasks/$TID -H "Authorization: Bearer $TOK")
  ST=$(echo "$S" | python -c 'import json,sys;print(json.load(sys.stdin)["status"])')
  [ "$ST" = "completed" ] || [ "$ST" = "failed" ] || [ "$ST" = "cancelled" ] && break
  sleep 2
done
echo "$S" > "$OUT/task-final.json"
echo "--- task final ---"
python - "$OUT/task-final.json" <<'PY'
import json,sys
t=json.load(open(sys.argv[1]))
print(f"  status={t['status']} provider={t.get('provider')} stepCount={t.get('stepCount')}")
for s in t.get("steps",[]):
    print(f"  step[{s.get('stepIndex')}] {s.get('type')}: {(s.get('result') or s.get('error') or '')[:120]}")
PY
python - "$OUT/task-final.json" <<'PY'
import json,sys
t=json.load(open(sys.argv[1]))
assert t["status"]=="completed", f"expected completed, got {t['status']}"
assert t.get("provider")=="deepseek", f"expected provider=deepseek, got {t.get('provider')}"
print("ACCEPTANCE PASSED: task completed via provider=deepseek")
PY
