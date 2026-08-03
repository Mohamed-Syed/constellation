#!/usr/bin/env python3
"""Task 7 live-proof driver — REAL cloud model end-to-end.

Requires OPENROUTER_API_KEY set in the repo-root .env (git-ignored) AND the
api booted AFTER that (scripts/boot-api-v0.3.sh reads the key at boot).
Submits the round's acceptance task (graphify graph.query via the CLOUD
model) and saves the literal record. Run: python scripts/live-task7-cloud.py
"""
import json
import sys
import time
import urllib.request

API = "http://localhost:4001/api"
OUT = "artifacts/engine-v0.3/task7-cloud-e2e.json"

def call(method, path, body=None, token=None, timeout=60):
    req = urllib.request.Request(f"{API}{path}", method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code, "_body": e.read().decode()[:500]}

def main():
    login = call("POST", "/auth/login", {"email": "admin@constellation.local", "password": "changeme"})
    token = login.get("accessToken")
    if not token:
        print("LOGIN FAILED:", json.dumps(login)[:300])
        sys.exit(1)
    print("login OK")

    # Sanity: the api must have been booted WITH the key.
    health = call("GET", "/engine/health", token=token)
    orh = next((p for p in health.get("model", {}).get("providers", []) if p.get("provider") == "openrouter"), {})
    print("health openrouter:", orh.get("reachable"), orh.get("error", ""))
    if not orh.get("reachable"):
        print("ABORT: OPENROUTER_API_KEY not picked up — set it in .env and REBOOT the api.")
        sys.exit(1)

    created = call("POST", "/engine/tasks", {
        "title": "v0.3 cloud E2E test",
        "prompt": "Call the graphify graph.query tool to find what services PluginLifecycleService depends on. Summarize in one sentence, then respond done.",
        "model": "openai/gpt-oss-120b",
        "maxSteps": 5,
    }, token)
    if "_http_error" in created:
        print("SUBMIT FAILED:", json.dumps(created)[:400])
        sys.exit(1)
    tid = created["id"]
    print(f"submitted {tid}")

    waited = 0
    while waited < 1500:
        time.sleep(10)
        waited += 10
        task = call("GET", f"/engine/tasks/{tid}", token=token)
        st = task.get("status")
        print(f"  ... {st} (steps={task.get('stepCount')}, provider={task.get('provider')!r})", flush=True)
        if st in ("completed", "failed", "cancelled"):
            with open(OUT, "w") as f:
                json.dump(task, f, indent=2)
            print(f"  final -> {st}; record saved to {OUT}")
            for s in task.get("steps", []):
                print(f"   step {s['stepIndex']} {s['type']}: {json.dumps(s.get('content'))[:200]}")
            sys.exit(0 if st == "completed" else 1)
    print("TIMEOUT")
    sys.exit(1)

if __name__ == "__main__":
    main()
