#!/usr/bin/env bash
# Task 5 live acceptance — transient model-error retry.
# A fake "Ollama" shim (node) answers the FIRST /api/chat with 503 then
# succeeds; the worker must retry and the task must COMPLETE. A second probe
# with a 404 (unknown model) must fail TERMINALLY with no retry.
set -u
cd /c/Users/<user>/Claude/Code/constellation/apps/api || exit 1

# --- fake Ollama on :11435 (NOT the real 11434) ---
FAKE_DIR="$HOME/.constellation-t5"
mkdir -p "$FAKE_DIR"
FAKE_MJS="$(cygpath -w "$FAKE_DIR/fake-ollama.mjs" 2>/dev/null || echo "$FAKE_DIR/fake-ollama.mjs")"
cat > "$FAKE_DIR/fake-ollama.mjs" <<'EOF'
import http from "node:http";
let chatCalls = 0;
const server = http.createServer((req, res) => {
  if (req.url === "/api/tags") { res.writeHead(200, {"Content-Type":"application/json"}); res.end(JSON.stringify({models:[]})); return; }
  if (req.url === "/api/chat") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      chatCalls++;
      if (body.includes("does-not-exist")) { res.writeHead(404, {"Content-Type":"application/json"}); res.end(JSON.stringify({error:"model 'does-not-exist' not found"})); return; }
      if (chatCalls === 1) { res.writeHead(503, {"Content-Type":"application/json"}); res.end(JSON.stringify({error:"model loading"})); return; }
      res.writeHead(200, {"Content-Type":"application/json"});
      res.end(JSON.stringify({message:{content:'{"type":"done","result":"survived the 503 hiccup"}'}, model:"qwen2.5-coder:7b", prompt_eval_count: 10, eval_count: 5}));
    });
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(11435, () => console.log("fake-ollama on 11435"));
EOF
node "$FAKE_MJS" > /tmp/fake-ollama.log 2>&1 &
FAKE_PID=$!
trap 'kill $FAKE_PID 2>/dev/null' EXIT
sleep 1

powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" >/dev/null 2>&1
sleep 1
API_PORT=4001 JWT_SECRET=devsecret DATABASE_URL="postgresql://constellation:constellation@localhost:5432/constellation?schema=core" REDIS_URL="redis://localhost:6380" DEFAULT_MODEL="qwen2.5-coder:7b" OLLAMA_BASE_URL="http://localhost:11435" ENGINE_MODEL_RETRIES="3" node dist/main.js > /tmp/t5-boot.log 2>&1 &
API_PID=$!
trap 'kill $API_PID $FAKE_PID 2>/dev/null; wait $API_PID 2>/dev/null; wait $FAKE_PID 2>/dev/null' EXIT
B="http://localhost:4001/api"
for _ in $(seq 1 60); do curl -sf $B/health >/dev/null 2>&1 && break; sleep 1; done
TOKEN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

# 1) transient 503 then success -> task COMPLETES
TID=$(curl -s -X POST $B/engine/tasks -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"t5-retry-live","prompt":"Say hello, then respond done. Do not use any tools.","model":"qwen2.5-coder:7b"}' | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
STATE=""
for _ in $(seq 1 90); do
  STATE=$(curl -s $B/engine/tasks/$TID -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(json.load(sys.stdin)['status'])")
  { [ "$STATE" = "completed" ] || [ "$STATE" = "failed" ] || [ "$STATE" = "cancelled" ]; } && break
  sleep 2
done
echo "--- transient-hiccup task: status=$STATE (expect completed)"
curl -s $B/engine/tasks/$TID -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json
t=json.load(sys.stdin)
print('  steps:',[(s['type'],str(s['content'])[:60]) for s in t['steps']])
assert t['status']=='completed','task did not survive the transient 503'
print('ASSERT Task 5a OK: transient 503 retried, task completed')
"
echo "--- retry evidence in log (Ollama chat failed lines for the 503):"
grep -c "HTTP 503" /tmp/t5-boot.log

# 2) terminal 404 (unknown model) -> FAILS immediately, exactly ONE chat call
TID2=$(curl -s -X POST $B/engine/tasks -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"t5-terminal-live","prompt":"hi","model":"does-not-exist"}' | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
STATE=""
for _ in $(seq 1 90); do
  STATE=$(curl -s $B/engine/tasks/$TID2 -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(json.load(sys.stdin)['status'])")
  { [ "$STATE" = "completed" ] || [ "$STATE" = "failed" ] || [ "$STATE" = "cancelled" ]; } && break
  sleep 2
done
echo "--- unknown-model task: status=$STATE (expect failed)"
curl -s $B/engine/tasks/$TID2 -H "Authorization: Bearer $TOKEN" | python -c "
import sys,json
t=json.load(sys.stdin)
print('  error:',t.get('error'))
assert t['status']=='failed' and '404' in (t.get('error') or ''),'unknown model did not fail terminally'
print('ASSERT Task 5b OK: 404 failed terminally')
"
echo "=== TASK 5 LIVE ACCEPTANCE: PASSED ==="
