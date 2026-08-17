#!/usr/bin/env bash
# Phase 4.0 4.6 — federated agent mesh LIVE PROOF, v2.
# Absolute paths everywhere (the v1 script's relative paths broke under the
# terminal session's persisted cwd). Boots the api on :4001 (Postgres) and a
# second instance on :4002 (peer sim, no DB — degraded but reachable health),
# then exercises the whole mesh surface. Evidence -> $ROOT/artifacts/mesh/.
set -u
# Repo root: derive from the script location (portable; the real Windows
# username is never hardcoded in tracked files).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p artifacts/mesh
OUT=$ROOT/artifacts/mesh/proof.log
B=http://localhost:4001/api
B2=http://localhost:4002

# 0. Free both ports (single-quoted PowerShell).
powershell -NoProfile -Command 'Get-NetTCPConnection -LocalPort 4001,4002 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }' >/dev/null 2>&1
sleep 1

# 0b. Clear the mesh_peers table from the previous proof run (dev DB only).
DBURL=$(grep -oE 'postgresql://constellation:[^"]+@localhost:5432/constellation' "$ROOT/scripts/boot-api-v0.3.sh" | head -1)
docker exec -i constellation-postgres psql -U constellation -d constellation -c 'DELETE FROM "core"."mesh_peers";' >/dev/null 2>&1

# 1. Boot the main api (:4001, Postgres) and the peer sim (:4002, no DB).
# `exec` inside the subshell makes $! the NODE pid (not the subshell), so the
# trap/kill below actually stops the server — the wrapper-only kill trap.
(cd "$ROOT/apps/api" && exec env API_PORT=4001 JWT_SECRET=devsecret DATABASE_URL="$DBURL" MESH_PROBE_INTERVAL_MS=5000 \
  node dist/main.js > "$OUT.api4001.log" 2>&1) &
API_PID=$!
(cd "$ROOT/apps/api" && exec env API_PORT=4002 JWT_SECRET=devsecret \
  node dist/main.js > "$OUT.api4002.log" 2>&1) &
PEER_PID=$!
trap 'kill $API_PID $PEER_PID 2>/dev/null' EXIT

echo "=== 1. boot + readiness (both instances) ===" | tee "$OUT"
for i in $(seq 1 60); do curl -sf "$B/health" >/dev/null && break; sleep 1; done
for i in $(seq 1 30); do curl -sf "$B2/api/health" >/dev/null && break; sleep 1; done
echo "main  /api/health -> $(curl -s -o NUL -w '%{http_code}' "$B/health")" | tee -a "$OUT"
echo "peer  /api/health -> $(curl -s -o NUL -w '%{http_code}' "$B2/api/health")" | tee -a "$OUT"
echo "--- main boot log: mesh routes mapped? ---" | tee -a "$OUT"
grep -c "MeshController" "$OUT.api4001.log" | tee -a "$OUT"
grep -oE "Mapped \{[^}]*mesh[^}]*\}" "$OUT.api4001.log" | tee -a "$OUT"

# 2. Admin login.
ADMIN_TOKEN=$(curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
echo "=== 2. admin login -> token ${#ADMIN_TOKEN} chars ===" | tee -a "$OUT"

# 3. Register edge-sim (points at the live :4002 instance), with an API key.
echo "=== 3. POST /mesh/peers {edge-sim -> :4002, apiKey} ===" | tee -a "$OUT"
curl -s -X POST "$B/mesh/peers" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"edge-sim","baseUrl":"http://localhost:4002","apiKey":"peer-secret"}' | tee -a "$OUT"
echo | tee -a "$OUT"

# 4. Register dark-site (nothing listens on :4999).
echo "=== 4. POST /mesh/peers {dark-site -> :4999} ===" | tee -a "$OUT"
curl -s -X POST "$B/mesh/peers" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"dark-site","baseUrl":"http://localhost:4999"}' | tee -a "$OUT"
echo | tee -a "$OUT"

# 5. Topology + counts.
echo "=== 5. GET /mesh/topology ===" | tee -a "$OUT"
curl -s "$B/mesh/topology" -H "Authorization: Bearer $ADMIN_TOKEN" | python -m json.tool | tee -a "$OUT"

# 6. RBAC: no token -> 401; viewer -> 403 on read AND write.
echo "=== 6. RBAC ===" | tee -a "$OUT"
echo "no token  GET topology  -> $(curl -s -o NUL -w '%{http_code}' "$B/mesh/topology")" | tee -a "$OUT"
VIEWER_TOKEN=$(curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"viewer@constellation.local","password":"changeme"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")
echo "viewer    GET topology  -> $(curl -s -o NUL -w '%{http_code}' "$B/mesh/topology" -H "Authorization: Bearer $VIEWER_TOKEN")" | tee -a "$OUT"
echo "viewer    POST peers    -> $(curl -s -o NUL -w '%{http_code}' -X POST "$B/mesh/peers" -H "Authorization: Bearer $VIEWER_TOKEN" -H 'Content-Type: application/json' -d '{"name":"nope","baseUrl":"http://localhost:4002"}')" | tee -a "$OUT"

# 7. The prober is REAL: kill :4002 -> probe -> down; reboot -> probe -> up.
EDGE_ID=$(curl -s "$B/mesh/topology" -H "Authorization: Bearer $ADMIN_TOKEN" | python -c "import sys,json;print([p['id'] for p in json.load(sys.stdin)['peers'] if p['name']=='edge-sim'][0])")
echo "=== 7. real prober: kill :4002 -> probe -> ? ===" | tee -a "$OUT"
kill "$PEER_PID" 2>/dev/null
sleep 2
curl -s -X POST "$B/mesh/peers/$EDGE_ID/probe" -H "Authorization: Bearer $ADMIN_TOKEN" | tee -a "$OUT"
echo | tee -a "$OUT"
echo "--- reboot :4002 ---" | tee -a "$OUT"
(cd "$ROOT/apps/api" && exec env API_PORT=4002 JWT_SECRET=devsecret \
  node dist/main.js > "$OUT.api4002.log" 2>&1) &
PEER_PID=$!
for i in $(seq 1 30); do curl -sf "$B2/api/health" >/dev/null && break; sleep 1; done
curl -s -X POST "$B/mesh/peers/$EDGE_ID/probe" -H "Authorization: Bearer $ADMIN_TOKEN" | tee -a "$OUT"
echo | tee -a "$OUT"

# 8. Duplicate name -> rejected (register returns null), delete dark-site.
echo "=== 8. duplicate name + delete ===" | tee -a "$OUT"
curl -s -X POST "$B/mesh/peers" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"edge-sim","baseUrl":"http://localhost:4002"}' | tee -a "$OUT"
echo | tee -a "$OUT"
DARK_ID=$(curl -s "$B/mesh/topology" -H "Authorization: Bearer $ADMIN_TOKEN" | python -c "import sys,json;print([p['id'] for p in json.load(sys.stdin)['peers'] if p['name']=='dark-site'][0])")
echo "DELETE dark-site -> $(curl -s -X DELETE "$B/mesh/peers/$DARK_ID" -H "Authorization: Bearer $ADMIN_TOKEN")" | tee -a "$OUT"

# 9. Final topology.
echo "=== 9. final topology ===" | tee -a "$OUT"
curl -s "$B/mesh/topology" -H "Authorization: Bearer $ADMIN_TOKEN" | python -m json.tool | tee -a "$OUT"

echo "=== DONE — tearing down ===" | tee -a "$OUT"
kill "$API_PID" "$PEER_PID" 2>/dev/null
sleep 2
echo "port 4001 free? $(netstat -ano | grep ':4001' | grep -c LISTEN || true)" | tee -a "$OUT"
echo "port 4002 free? $(netstat -ano | grep ':4002' | grep -c LISTEN || true)" | tee -a "$OUT"
