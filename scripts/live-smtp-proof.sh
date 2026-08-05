#!/usr/bin/env bash
# Phase 3.0 — NOTIFICATION SMTP CHANNEL live proof (Polaris). ONE invocation:
#  1) run a LOCAL SMTP stub on :9025 that records every message;
#  2) boot api EMBEDDED with SMTP_HOST=127.0.0.1 SMTP_PORT=9025;
#  3) create an SMTP channel (to ops@constellation.local, all events);
#  4) POST /channels/:id/test -> the stub records the TEST mail;
#  5) trigger a doomed task -> engine.task.failed -> the stub records the
#     FAILURE mail (subject + body with kind/severity/task id).
# Api LEFT RUNNING for a browser spot-check if desired.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=artifacts/smtp-channel
mkdir -p "$OUT"
: > "$OUT/smtp.log"

python scripts/smtp-stub.py 9025 "$OUT/smtp.log" > /dev/null 2>&1 &
STUB=$!
trap 'kill $STUB 2>/dev/null || true; sleep 1; powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" >/dev/null 2>&1 || true' EXIT
sleep 1

FREE_PORT='Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true
sleep 1

export SMTP_HOST=127.0.0.1 SMTP_PORT=9025 SMTP_FROM=constellation@localhost
ENGINE_WORKER_MODE=embedded bash scripts/boot-api-v0.3.sh > "$OUT/api.log" 2>&1 &
API_PID=$!
trap 'kill $API_PID $STUB 2>/dev/null || true; sleep 1; powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true' EXIT

ready=0
for _ in $(seq 1 90); do code=$(curl -s -o NUL -w '%{http_code}' http://localhost:4001/api/health || true); [ "$code" = "200" ] && ready=1 && break; sleep 1; done
[ "$ready" = "1" ] || { echo "API BOOT FAILED"; tail -15 "$OUT/api.log"; exit 1; }
echo "API ready on :4001 (embedded, SMTP_HOST=127.0.0.1:9025)"

TOK=$(curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')

# 3. SMTP channel
curl -s -X POST http://localhost:4001/api/notifications/channels -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"name":"ops-mail","type":"smtp","to":"ops@constellation.local","from":"constellation@localhost","kinds":[]}' > "$OUT/channel.json"
CID=$(python -c "import json;print(json.load(open('$OUT/channel.json'))['channel']['id'])")
echo "smtp channel: $CID -> $(cat "$OUT/channel.json")"

# 4. Test button
echo "POST /channels/$CID/test ..."
curl -s -X POST http://localhost:4001/api/notifications/channels/$CID/test -H "Authorization: Bearer $TOK" > "$OUT/test-result.json"
cat "$OUT/test-result.json"; echo

# 5. doomed task -> engine.task.failed -> mail
curl -s -X POST http://localhost:4001/api/engine/tasks -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"title":"smtp-proof-doomed","prompt":"must fail","model":"ollama:does-not-exist-smtp","maxSteps":2}' > "$OUT/doomed-task.json"
echo "doomed task submitted: $(python -c "import json;print(json.load(open('$OUT/doomed-task.json'))['id'])")"

for _ in $(seq 1 40); do
  N=$(grep -c "^=== MESSAGE" "$OUT/smtp.log" || true)
  [ "$N" -ge 2 ] && break; sleep 2
done
echo
echo "=== LITERAL SMTP STUB RECORD ($(grep -c '^=== MESSAGE' "$OUT/smtp.log" || true) messages) ==="
cat "$OUT/smtp.log"

echo
echo "API LEFT RUNNING on :4001"
trap - EXIT
exit 0
