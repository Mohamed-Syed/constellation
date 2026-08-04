#!/usr/bin/env bash
# Phase 2.0 2.7 — PLUGIN SANDBOX live proof. ONE invocation:
# free :4001 → boot api with PLUGIN_SANDBOX_MODE=process (graphify +
# sandbox-test, 8s timeout) → invoke every failure class through the REAL
# HTTP invoke endpoint → assert the api survives each one → save evidence.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
OUT=artifacts/plugin-sandbox
mkdir -p "$OUT"

FREE_PORT='Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true
sleep 1

PLUGIN_SANDBOX_MODE=process \
PLUGIN_SANDBOX_PLUGINS=graphify,sandbox-test \
PLUGIN_SANDBOX_TIMEOUT_MS=8000 \
bash scripts/boot-api-v0.3.sh > "$OUT/boot.log" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true; sleep 1; powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true' EXIT

ready=0
for _ in $(seq 1 90); do code=$(curl -s -o NUL -w '%{http_code}' http://localhost:4001/api/health || true); [ "$code" = "200" ] && ready=1 && break; sleep 1; done
[ "$ready" = "1" ] || { echo "BOOT FAILED"; tail -15 "$OUT/boot.log"; exit 1; }
echo "API ready on :4001"
echo "--- sandbox boot log line ---"
grep -i 'sandbox' "$OUT/boot.log" | head -2

TOK=$(curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')

invoke() {
  local plugin=$1 tool=$2
  curl -s -X POST "http://localhost:4001/api/plugins/$plugin/invoke" \
    -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
    -d "{\"tool\":\"$tool\",\"args\":{}}"
}

echo "--- 1. graphify.graph.query SANDBOXED (child process calls the live MCP sidecar) ---"
curl -s -X POST http://localhost:4001/api/plugins/graphify/invoke \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"tool":"graph.query","args":{"question":"What services does PluginToolService depend on?"}}' > "$OUT/1-graphify-ok.json"
python -c "
import json
r=json.load(open('$OUT/1-graphify-ok.json'))
print('  ok:', r.get('ok'), '| nodes in payload:', '39 nodes' in str(r.get('data', {}).get('text', '')) or 'nodes' in str(r.get('data', {}).get('text', ''))[:100], '| error:', r.get('error'))
"

echo "--- 2. sandbox.ping (normal tool, works in the child) ---"
invoke sandbox-test sandbox.ping > "$OUT/2-ping.json"
python -c "
import json; r=json.load(open('$OUT/2-ping.json'))
print('  ', json.dumps(r.get('result', r))[:200])
"

echo "--- 3. sandbox.boom (throws in the child → contained) ---"
invoke sandbox-test sandbox.boom > "$OUT/3-boom.json"
python -c "
import json; r=json.load(open('$OUT/3-boom.json'))
print('  result:', json.dumps(r.get('result', r))[:200])
"

echo "--- 4. sandbox.crash (process.exit(1) in the CHILD — api must survive) ---"
invoke sandbox-test sandbox.crash > "$OUT/4-crash.json"
python -c "
import json; r=json.load(open('$OUT/4-crash.json'))
print('  result:', json.dumps(r.get('result', r))[:220])
"
code=$(curl -s -o NUL -w '%{http_code}' http://localhost:4001/api/health || true)
echo "  api /health after crash: $code"

echo "--- 5. sandbox.hang (never resolves → killed at the 8s timeout) ---"
invoke sandbox-test sandbox.hang > "$OUT/5-hang.json"
python -c "
import json; r=json.load(open('$OUT/5-hang.json'))
print('  result:', json.dumps(r.get('result', r))[:220])
"
code=$(curl -s -o NUL -w '%{http_code}' http://localhost:4001/api/health || true)
echo "  api /health after hang: $code"

echo "--- acceptance ---"
python - "$OUT" <<'PY'
import json, sys, os
out = sys.argv[1]
def body(name):
    return json.load(open(os.path.join(out, name)))

g = body("1-graphify-ok.json")
# The invoke envelope carries {pluginId, tool, durationMs, ok, data} for graphify
# and {pluginId, tool, durationMs, ok, error} for sandbox-test (no nested result).
assert g.get("ok") is True, f"graphify sandboxed invoke failed: {g.get('error')}"
assert "39 nodes" in str(g.get("data", {}).get("text", "")), "graphify data missing"
p = body("2-ping.json")
assert p.get("ok") is True and "child process" in str(p.get("result", "")), f"ping: {p}"
b = body("3-boom.json")
assert b.get("ok") is False and "boom from the sandbox" in str(b.get("error", "")), f"boom: {b}"
c = body("4-crash.json")
assert c.get("ok") is False and "exit 1" in str(c.get("error", "")), f"crash: {c}"
h = body("5-hang.json")
assert h.get("ok") is False and "killed by timeout after 8000ms" in str(h.get("error", "")), f"hang: {h}"
print("ACCEPTANCE PASSED: sandbox contained boom/crash/hang; graphify worked in the child")
PY
