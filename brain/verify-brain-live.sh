#!/usr/bin/env bash
# Live verification of the brain REST surface on port 4001.
set -u
cd "$(dirname "$0")/../apps/api" || exit 1

# free the port (stale dist/main.js has squatted it before)
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" >/dev/null 2>&1
sleep 1

API_PORT=4001 JWT_SECRET=devsecret \
  DATABASE_URL="${DATABASE_URL:-postgresql://constellation:constellation@localhost:5432/constellation}" \
  node dist/main.js > /tmp/brain-boot.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null' EXIT

for i in $(seq 1 40); do
  curl -sf http://localhost:4001/api/health >/dev/null 2>&1 && break
  sleep 1
done

B=http://localhost:4001/api
echo "=== health ==="
curl -s $B/health | head -c 300; echo

echo "=== brain/stats WITHOUT a token (expect 401) ==="
curl -s -o /dev/null -w "http=%{http_code}\n" $B/brain/stats

echo "=== login as admin ==="
LOGIN=$(curl -s -X POST $B/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}')
echo "$LOGIN" | head -c 200; echo
TOKEN=$(echo "$LOGIN" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then echo "NO TOKEN (no database seeded) — stopping after the authz check"; exit 0; fi
AUTH="Authorization: Bearer $TOKEN"

echo "=== brain/stats (expect available:false, brain not built yet) ==="
curl -s -H "$AUTH" $B/brain/stats; echo
echo "=== brain/graph (expect empty graph + reason) ==="
curl -s -H "$AUTH" $B/brain/graph; echo
echo "=== brain/query BEFORE remember (expect grounded:false) ==="
curl -s -H "$AUTH" -H 'content-type: application/json' -X POST $B/brain/query \
  -d '{"question":"what connects the plugin loader to the SDK?"}'; echo
echo "=== brain/remember ==="
curl -s -H "$AUTH" -H 'content-type: application/json' -X POST $B/brain/remember \
  -d '{"title":"Plugin loader reaches the SDK via the manifest contract","body":"The loader validates plugin.manifest.json with the SDK Zod schema, then dynamic-imports the entry with pathToFileURL.","tags":["loader","sdk"],"source":"nova-verify"}'; echo
echo "=== brain/query AFTER remember (expect a vault match, still grounded:false) ==="
curl -s -H "$AUTH" -H 'content-type: application/json' -X POST $B/brain/query \
  -d '{"question":"how does the loader reach the SDK manifest?"}'; echo
echo "=== brain/stats AFTER remember (vaultNotes should be >= 1) ==="
curl -s -H "$AUTH" $B/brain/stats; echo
echo "=== validation: empty title (expect 400) ==="
curl -s -o /dev/null -w "http=%{http_code}\n" -H "$AUTH" -H 'content-type: application/json' \
  -X POST $B/brain/remember -d '{"title":"","body":"x"}'
echo "=== boot log: brain-related lines ==="
grep -i -E "brain|graphify" /tmp/brain-boot.log | head -5
