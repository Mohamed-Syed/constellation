#!/usr/bin/env bash
# Phase 4.0 4.1 — CREWS (task delegation) live proof (Polaris). ONE invocation:
#  1) boot api EMBEDDED (engine worker in-process so bus events deliver);
#  2) REST: submit a parent task -> delegate 2 sub-agents -> poll to terminal
#     -> GET tree (parent + 2 children) -> viewer RBAC 403;
#  3) MCP: constellation.delegate_task round-trip on POST /api/mcp;
#  4) leave the api UP for the browser phase (scripts/flow-crews.json).
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p artifacts/crews

kill_api() { powershell -NoProfile -Command 'Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }' 2>/dev/null || true; sleep 2; }
kill_api
ENGINE_WORKER_MODE=embedded bash scripts/boot-api-v0.3.sh > artifacts/crews/api.log 2>&1 &
for i in $(seq 1 90); do code=$(curl -s -o NUL -w '%{http_code}' http://localhost:4001/api/health || true); [ "$code" = "200" ] && break; sleep 1; done
echo "api up: $code"

TOKEN=$(curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])')
VTOKEN=$(curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"viewer@constellation.local","password":"changeme"}' | python -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])')

echo "== 1. parent task =="
PARENT=$(curl -s -X POST http://localhost:4001/api/engine/tasks -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"crews-parent","prompt":"Your entire response must be exactly the single token ORCH_OK and nothing else. Do not add any text, explanation, or punctuation.","maxSteps":6}')
P_ID=$(echo "$PARENT" | python -c 'import json,sys; print(json.load(sys.stdin)["id"])')
echo "parent id: $P_ID"
for i in $(seq 1 40); do ST=$(curl -s "http://localhost:4001/api/engine/tasks/$P_ID" -H "Authorization: Bearer $TOKEN" | python -c 'import json,sys; print(json.load(sys.stdin).get("status",""))'); [ "$ST" = "completed" ] || [ "$ST" = "failed" ] && break; sleep 2; done
echo "parent final: $ST"

echo "== 2. delegate two sub-agents =="
C1=$(curl -s -X POST "http://localhost:4001/api/engine/tasks/$P_ID/delegate" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"sub-agent-a","prompt":"You are a compliance test. Reply with ONLY the exact token SUB_A_OK. No preamble, no explanation, no markdown.","maxSteps":6}')
C2=$(curl -s -X POST "http://localhost:4001/api/engine/tasks/$P_ID/delegate" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"sub-agent-b","prompt":"You are a compliance test. Reply with ONLY the exact token SUB_B_OK. No preamble, no explanation, no markdown.","maxSteps":6}')
echo "$C1" | python -m json.tool > artifacts/crews/delegate-a.json
echo "$C2" | python -m json.tool > artifacts/crews/delegate-b.json
C1_ID=$(echo "$C1" | python -c 'import json,sys; print(json.load(sys.stdin)["task"]["id"])')
C2_ID=$(echo "$C2" | python -c 'import json,sys; print(json.load(sys.stdin)["task"]["id"])')
echo "children: $C1_ID $C2_ID"
sleep 6
for i in $(seq 1 40); do
  S1=$(curl -s "http://localhost:4001/api/engine/tasks/$C1_ID" -H "Authorization: Bearer $TOKEN" | python -c 'import json,sys; print(json.load(sys.stdin).get("status",""))')
  S2=$(curl -s "http://localhost:4001/api/engine/tasks/$C2_ID" -H "Authorization: Bearer $TOKEN" | python -c 'import json,sys; print(json.load(sys.stdin).get("status",""))')
  echo "  child statuses: $S1 $S2"
  [ "$S1" = "completed" ] && [ "$S2" = "completed" ] && break
  sleep 3
done

echo "== 3. delegation tree =="
curl -s "http://localhost:4001/api/engine/tasks/$P_ID/tree" -H "Authorization: Bearer $TOKEN" | python -m json.tool > artifacts/crews/tree.json
python - <<'PY'
import json
t = json.load(open("artifacts/crews/tree.json"))
print(f"tree root: {t['id']} status={t['status']} children={len(t['children'])}")
for c in t["children"]:
    print(f"  child: {c['id']} title={c['title']} status={c['status']} tokens={c.get('totalTokens')} cost={c.get('costUSD')}")
assert len(t["children"]) == 2, "expected 2 children"
assert all(c["status"] in ("completed", "failed", "cancelled") for c in t["children"]), "children not terminal"
print("TREE OK")
PY

echo "== 4. viewer RBAC on delegation =="
VCODE=$(curl -s -o NUL -w '%{http_code}' -X POST "http://localhost:4001/api/engine/tasks/$P_ID/delegate" -H "Authorization: Bearer $VTOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"sneaky","prompt":"x"}')
echo "viewer delegate -> HTTP $VCODE (expect 403)"
[ "$VCODE" = "403" ] && echo "RBAC OK"

echo "== 5. MCP constellation.delegate_task =="
MCP=$(curl -s -X POST http://localhost:4001/api/mcp -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"constellation.delegate_task\",\"arguments\":{\"parentId\":\"$P_ID\",\"title\":\"mcp-sub-agent\",\"prompt\":\"You are a compliance test. Reply with ONLY the exact token MCP_SUB_OK. No preamble, no explanation, no markdown.\",\"maxSteps\":3,\"waitMs\":120000}}}")
echo "$MCP" | python -m json.tool > artifacts/crews/mcp-delegate.json
python - <<'PY'
import json
m = json.load(open("artifacts/crews/mcp-delegate.json"))
res = m.get("result", {})
print("mcp result:", json.dumps(res, default=str)[:300])
PY

echo "== DONE — api left UP for the browser phase =="
