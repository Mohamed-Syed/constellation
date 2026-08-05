#!/usr/bin/env bash
# Phase 4.0 — MCP SERVER live proof (Polaris). ONE invocation:
#  1) boot api EMBEDDED;
#  2) run a REAL MCP client exchange over JSON-RPC 2.0 on POST /api/mcp:
#     initialize -> tools/list -> tools/call list_tasks -> tools/call
#     run_task (a REAL task completes on Ollama) -> tools/call engine_health;
#  3) capture every literal response under artifacts/mcp/.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=artifacts/mcp
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

TOK=$(curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')
MCP() { curl -s -X POST http://localhost:4001/api/mcp -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d "$1"; }

# 1. initialize
MCP '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"polaris-proof","version":"1.0"}}}' > "$OUT/01-initialize.json"
echo "== initialize =="; python -m json.tool "$OUT/01-initialize.json" | head -12

# 2. tools/list
MCP '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' > "$OUT/02-tools-list.json"
echo "== tools/list =="; python -c "import json;d=json.load(open('$OUT/02-tools-list.json'));print([t['name'] for t in d['result']['tools']])"

# 3. tools/call list_tasks
MCP '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"constellation.list_tasks","arguments":{}}}' > "$OUT/03-list-tasks.json"
echo "== list_tasks =="; python -c "import json;d=json.load(open('$OUT/03-list-tasks.json'));print(d['result']['content'][0]['text'][:200])"

# 4. tools/call run_task — REAL task on Ollama
MCP '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"constellation.run_task","arguments":{"title":"mcp-proof","prompt":"Reply with exactly this JSON: {\"type\":\"done\",\"result\":\"mcp-ok\"}","maxSteps":3}}}' > "$OUT/04-run-task.json"
echo "== run_task (waits for the real Ollama run) =="
python - "$OUT/04-run-task.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(d["result"]["content"][0]["text"][:300])
PY

# 5. tools/call engine_health
MCP '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"constellation.engine_health","arguments":{}}}' > "$OUT/05-health.json"
echo "== engine_health =="; python -c "import json;d=json.load(open('$OUT/05-health.json'));print(json.loads(d['result']['content'][0]['text']).keys())"

# 6. negative: unknown tool + no auth
MCP '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"constellation.nope","arguments":{}}}' > "$OUT/06-unknown-tool.json"
echo "== unknown tool isError =="; python -c "import json;d=json.load(open('$OUT/06-unknown-tool.json'));print('isError:', d['result']['isError'])"
curl -s -o "$OUT/07-no-auth.json" -w 'no-auth HTTP %{http_code}\n' -X POST http://localhost:4001/api/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":7,"method":"ping"}'

echo
echo "API LEFT RUNNING on :4001"
trap - EXIT
exit 0
