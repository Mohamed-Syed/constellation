#!/usr/bin/env bash
# Phase 4.0 4.4 — SKILL MARKETPLACE live proof. api must already be UP.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p artifacts/skills

TOKEN=$(curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@constellation.local","password":"changeme"}' | python -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])')

echo "== catalog =="
curl -s http://localhost:4001/api/skills -H "Authorization: Bearer $TOKEN" > artifacts/skills/catalog.json
python - <<'PY'
import json
cats = json.load(open("artifacts/skills/catalog.json"))
print(f"catalog: {len(cats)} skills, installed: {sum(1 for c in cats if c['installed'])}")
print("ids:", [c["id"] for c in cats][:4], "...")
PY

echo "== install 2 skills =="
curl -s -X POST http://localhost:4001/api/skills/daily-pr-triage/install -H "Authorization: Bearer $TOKEN" > artifacts/skills/install-a.json
curl -s -X POST http://localhost:4001/api/skills/ssl-cert-expiry-monitor/install -H "Authorization: Bearer $TOKEN" > artifacts/skills/install-b.json
python - <<'PY'
import json
a = json.load(open("artifacts/skills/install-a.json"))
b = json.load(open("artifacts/skills/install-b.json"))
print("installed:", a["skill"]["id"], "enabled:", a["skill"]["enabled"], "next:", a["skill"]["nextRunAt"])
print("installed:", b["skill"]["id"])
assert a["ok"] and b["ok"]
PY

echo "== schedules created =="
curl -s http://localhost:4001/api/engine/schedules -H "Authorization: Bearer $TOKEN" > artifacts/skills/schedules.json
python - <<'PY'
import json
rows = json.load(open("artifacts/skills/schedules.json"))
skills = [r for r in rows if r["name"].startswith("skill:")]
for r in skills:
    print(f"  {r['name']} cron={r['spec'].get('cron')} enabled={r['enabled']} title={r['title']}")
assert len(skills) == 2, "expected 2 skill schedules"
assert all(r["spec"].get("cron") for r in skills)
print("SCHEDULES OK")
PY

echo "== toggle + uninstall =="
curl -s -X POST http://localhost:4001/api/skills/daily-pr-triage/toggle -H "Authorization: Bearer $TOKEN" > artifacts/skills/toggle.json
curl -s -X POST http://localhost:4001/api/skills/ssl-cert-expiry-monitor/uninstall -H "Authorization: Bearer $TOKEN" > artifacts/skills/uninstall.json
python - <<'PY'
import json
t = json.load(open("artifacts/skills/toggle.json"))
u = json.load(open("artifacts/skills/uninstall.json"))
print("after toggle enabled:", t["skill"]["enabled"], "| uninstall ok:", u["ok"])
assert t["skill"]["enabled"] is False and u["ok"] is True
PY
curl -s http://localhost:4001/api/engine/schedules -H "Authorization: Bearer $TOKEN" | python -c '
import json,sys
rows = json.load(sys.stdin)
skills = [r for r in rows if r["name"].startswith("skill:")]
print("skill schedules remaining:", [r["name"] for r in skills])
assert len(skills) == 1 and skills[0]["name"] == "skill:daily-pr-triage"
print("TOGGLE+UNINSTALL OK")'
echo "== viewer cannot install (403) =="
VTOKEN=$(curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' -d '{"email":"viewer@constellation.local","password":"changeme"}' | python -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])')
CODE=$(curl -s -o NUL -w '%{http_code}' -X POST http://localhost:4001/api/skills/daily-pr-triage/install -H "Authorization: Bearer $VTOKEN")
echo "viewer install -> HTTP $CODE (expect 403)"
[ "$CODE" = "403" ] && echo "RBAC OK"
echo "== DONE =="
