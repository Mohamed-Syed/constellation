#!/usr/bin/env bash
# Phase 2.0 2.6 — portal-tile leg: boot api (SSO) + web dev :3005, drive a
# REAL browser (zero-dep CDP) through login -> /tools, capture tile evidence.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
OUT=artifacts/sso-roundtrip
OUT_ABS="$(pwd)/$OUT"

FREE_PORT='Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
FREE_3005='Get-NetTCPConnection -LocalPort 3005 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true
powershell -NoProfile -Command "$FREE_3005" >/dev/null 2>&1 || true
sleep 1

bash scripts/boot-api-sso.sh > "$OUT_ABS/boot-api.log" 2>&1 &
API_PID=$!
( cd apps/web && ./node_modules/.bin/next dev -p 3005 > "$OUT_ABS/boot-web.log" 2>&1 ) &
WEB_PID=$!
trap 'kill $API_PID $WEB_PID 2>/dev/null || true; sleep 1; powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true; powershell -NoProfile -Command "$FREE_3005" >/dev/null 2>&1 || true' EXIT

api_ready=0
for _ in $(seq 1 90); do code=$(curl -s -o NUL -w '%{http_code}' http://localhost:4001/api/health || true); [ "$code" = "200" ] && api_ready=1 && break; sleep 1; done
[ "$api_ready" = "1" ] || { echo "API BOOT FAILED"; tail -15 "$OUT_ABS/boot-api.log"; exit 1; }
echo "api ready: $(curl -s -o NUL -w '%{http_code}' http://localhost:4001/api/health || true)"

web_ready=0
for _ in $(seq 1 120); do code=$(curl -s -o NUL -w '%{http_code}' --max-time 10 http://localhost:3005/login || true); [ "$code" = "200" ] && web_ready=1 && break; sleep 1; done
[ "$web_ready" = "1" ] || { echo "WEB BOOT FAILED"; tail -15 "$OUT_ABS/boot-web.log"; exit 1; }
echo "web ready on :3005"
echo "--- federation modules (api) ---"
curl -s http://localhost:4001/api/federation/modules -H "Authorization: Bearer $(curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')" | python -c 'import json,sys;d=json.load(sys.stdin);print([m.get("id") for m in d] if isinstance(d,list) else d)'

echo "--- CDP browser flow ---"
node scripts/cdp-browser.mjs scripts/flow-sso-tools.json "$OUT" 2>&1 | tail -60
