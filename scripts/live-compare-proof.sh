#!/usr/bin/env bash
# Phase 3.0 3.6 — MULTI-MODEL COMPARE live proof. ONE invocation:
#  1) boot api EMBEDDED (postgres + redis + ollama; deepseek key from .env);
#  2) submit the SAME prompt as two engine tasks — one on local ollama
#     (qwen2.5-coder:7b), one on the cloud DeepSeek provider
#     (deepseek-v4-flash) — the multi-model compare A/B;
#  3) wait both to terminal, fetch details, and print the PERSISTED usage:
#     inputTokens / outputTokens / totalTokens / costUSD + latency — the
#     per-call usage/cost persistence gap (carried since v0.3) is now closed.
# Api is LEFT RUNNING for the browser phase (flow-compare.json).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=artifacts/compare
mkdir -p "$OUT"

FREE_PORT='Get-NetTCPConnection -LocalPort 4001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }'
powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true
sleep 1

export SCHEDULER_POLL_INTERVAL_MS=5000
ENGINE_WORKER_MODE=embedded bash scripts/boot-api-v0.3.sh > "$OUT/api.log" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true; sleep 1; powershell -NoProfile -Command "$FREE_PORT" >/dev/null 2>&1 || true' EXIT

ready=0
for _ in $(seq 1 90); do code=$(curl -s -o NUL -w '%{http_code}' http://localhost:4001/api/health || true); [ "$code" = "200" ] && ready=1 && break; sleep 1; done
[ "$ready" = "1" ] || { echo "API BOOT FAILED"; tail -15 "$OUT/api.log"; exit 1; }
echo "API ready on :4001 (embedded)"

TOK=$(curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')
[ -n "$TOK" ] || { echo "LOGIN FAILED"; exit 1; }

PROMPT="Explain in one sentence what a durable task queue is."
for M in qwen2.5-coder:7b deepseek-v4-flash; do
  TAG=$(echo "$M" | tr ':' '-')
  curl -s -X POST http://localhost:4001/api/engine/tasks -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
    -d "{\"title\":\"compare-$TAG\",\"prompt\":\"$PROMPT\",\"model\":\"$M\",\"maxSteps\":2}" > "$OUT/submit-$TAG.json"
  TID=$(python -c "import json;print(json.load(open('$OUT/submit-$TAG.json'))['id'])")
  echo "task $TAG: $TID"
  for _ in $(seq 1 90); do
    D=$(curl -s http://localhost:4001/api/engine/tasks/$TID -H "Authorization: Bearer $TOK")
    ST=$(echo "$D" | python -c 'import json,sys;print(json.load(sys.stdin)["status"])')
    case "$ST" in completed|failed|cancelled) break;; esac
    sleep 2
  done
  echo "$D" > "$OUT/task-$TAG.json"
done

python - "$OUT" <<'PY'
import json, os, sys, datetime
out = sys.argv[1]
def load(n): return json.load(open(os.path.join(out, n)))
print("--- multi-model compare: persisted usage per model ---")
for tag in ("qwen2.5-coder-7b", "deepseek-v4-flash"):
    t = load(f"task-{tag}.json")
    lat = ""
    if t.get("startedAt") and t.get("completedAt"):
        a = datetime.datetime.fromisoformat(t["startedAt"].replace("Z", "+00:00"))
        b = datetime.datetime.fromisoformat(t["completedAt"].replace("Z", "+00:00"))
        lat = f"{(b-a).total_seconds():.1f}s"
    print(f"  {tag:18s} status={t['status']:10s} provider={t.get('provider')} latency={lat:8s} "
          f"tokens in/out/total={t.get('inputTokens')}/{t.get('outputTokens')}/{t.get('totalTokens')} "
          f"costUSD={t.get('costUSD')}")
    print(f"    result: {str(t.get('result'))[:110]}")
PY

echo
echo "API LEFT RUNNING on :4001 for the browser phase (flow-compare.json)"
trap - EXIT
exit 0
