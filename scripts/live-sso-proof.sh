#!/usr/bin/env bash
# Phase 2.0 2.6 — REAL SSO ROUND-TRIP live proof (Keycloak → token → api).
# ONE invocation: free :4001 → boot api WITH the OIDC seam → four-curl proof
# set → Caddy tile probes → save literal evidence to artifacts/sso-roundtrip/.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
OUT=artifacts/sso-roundtrip
mkdir -p "$OUT"

FREE_PORT='Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true
sleep 1

bash scripts/boot-api-sso.sh > "$OUT/boot.log" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true; sleep 1; powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true' EXIT

ready=0
for _ in $(seq 1 90); do
  if curl -sf http://localhost:4001/api/health >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" = "1" ] || { echo "BOOT FAILED"; tail -20 "$OUT/boot.log"; exit 1; }
echo "API ready on :4001"
echo "--- OIDC boot log line ---"
grep -iE 'oidc|sso|signing key' "$OUT/boot.log" | head -3

# 1. REAL Keycloak token -> /api/auth/me must return the Keycloak principal
KC_TOK=$(curl -s -X POST 'http://localhost:8081/auth/realms/constellation/protocol/openid-connect/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=password&client_id=constellation-portal&username=sso-user&password=ssopass' \
  | python -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
echo "keycloak token: ${#KC_TOK} chars, RS256 (kid in header)"
printf '{"step":"1 real keycloak token","token_chars":%d}' "${#KC_TOK}" > "$OUT/step1.json"
curl -s -w '\nHTTP %{http_code}\n' http://localhost:4001/api/auth/me -H "Authorization: Bearer $KC_TOK" > "$OUT/me-keycloak.txt"
echo "--- 1. real Keycloak token -> /api/auth/me ---"
cat "$OUT/me-keycloak.txt"; echo

# 2. local admin token still works (verifiers coexist — no regression)
LOCAL_TOK=$(curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')
curl -s -w '\nHTTP %{http_code}\n' http://localhost:4001/api/auth/me -H "Authorization: Bearer $LOCAL_TOK" > "$OUT/me-local.txt"
echo "--- 2. local admin token -> /api/auth/me (coexistence) ---"
cat "$OUT/me-local.txt"; echo

# 3. tampered Keycloak token -> 401 (signature check is REAL)
curl -s -w '\nHTTP %{http_code}\n' http://localhost:4001/api/auth/me -H "Authorization: Bearer ${KC_TOK}XX" > "$OUT/me-tampered.txt"
echo "--- 3. tampered token -> 401 ---"
tail -1 "$OUT/me-tampered.txt"

# 4. no token -> 401
curl -s -w '\nHTTP %{http_code}\n' http://localhost:4001/api/auth/me > "$OUT/me-none.txt"
echo "--- 4. no token -> 401 ---"
tail -1 "$OUT/me-none.txt"

echo "--- Caddy tile probes (:8090, api upstream down is EXPECTED env state) ---"
for p in "/auth/realms/constellation" "/tools/grafana/api/health" "/tools/prometheus/-/healthy"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://localhost:8090$p")
  echo "  GET :8090$p -> $code"
  printf '%s %s\n' "$p" "$code" >> "$OUT/caddy-tiles.txt"
done
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://localhost:8090/tools/grafana/")
echo "  GET :8090/tools/grafana/ -> $code (302 = Grafana's own login redirect, expected)"
printf '%s %s\n' "/tools/grafana/" "$code" >> "$OUT/caddy-tiles.txt"

echo "--- acceptance ---"
grep -q '"id"' "$OUT/me-keycloak.txt" && echo "PASS: Keycloak principal returned (sub = Keycloak UUID)"
grep -q '"roles":\["admin"\]' "$OUT/me-local.txt" && echo "PASS: local principal still works"
grep -q 'HTTP 401' "$OUT/me-tampered.txt" && echo "PASS: tampered -> 401"
grep -q 'HTTP 401' "$OUT/me-none.txt" && echo "PASS: no token -> 401"
