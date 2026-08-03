#!/usr/bin/env bash
# Task 2 regression check: api boots clean with Redis DOWN (Task 1 no-regression).
set -u
cd /c/Users/<user>/Claude/Code/constellation/apps/api || exit 1
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" >/dev/null 2>&1
sleep 1
API_PORT=4001 JWT_SECRET=devsecret DATABASE_URL="postgresql://constellation:constellation@localhost:5432/constellation?schema=core" REDIS_URL="redis://localhost:6399" DEFAULT_MODEL="qwen2.5-coder:7b" node dist/main.js > /tmp/t2-redisdown.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null; wait $API_PID 2>/dev/null' EXIT
for _ in $(seq 1 40); do curl -sf http://localhost:4001/api/health >/dev/null 2>&1 && break; sleep 1; done
echo "--- /api/health:"; curl -s http://localhost:4001/api/health | head -c 150; echo
echo "--- /api/engine/health:"; curl -s http://localhost:4001/api/engine/health | python -c "import sys,json;d=json.load(sys.stdin);print('engine:',d['engine'],'| reason:',d['reason'])" 2>/dev/null
echo "--- engine-unavailable warnings in log (expect >=1):"; grep -c "NOT started\|EngineUnavailable\|engine unavailable" /tmp/t2-redisdown.log
echo "--- ECONNREFUSED/retry lines (expect 0):"; grep -ci "ECONNREFUSED" /tmp/t2-redisdown.log || echo 0
echo "--- engine warning total (expect exactly 2: queue + worker skip):"; grep -c "NOT started" /tmp/t2-redisdown.log
