#!/usr/bin/env python3
"""Task 8 live-proof driver — no-key fallback behavior.

Submits three engine tasks against the LIVE api (:4001, OpenRouter
UNCONFIGURED) and polls each to completion, saving the literal task records
as JSON evidence. Run: python scripts/live-task8-fallback.py
"""
import json
import sys
import time
import urllib.request

API = "http://localhost:4001/api"
OUT_DIR = "artifacts/engine-v0.3"

def call(method, path, body=None, token=None, timeout=30):
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

def submit_and_poll(token, title, prompt, model, max_steps=3, poll_every=8, max_wait=900):
    created = call("POST", "/engine/tasks", {"title": title, "prompt": prompt, "model": model, "maxSteps": max_steps}, token)
    if "_http_error" in created:
        return created
    tid = created["id"]
    print(f"  submitted {title}: id={tid} model={model!r}")
    waited = 0
    while waited < max_wait:
        time.sleep(poll_every)
        waited += poll_every
        task = call("GET", f"/engine/tasks/{tid}", token=token)
        if "_http_error" in task:
            return task
        st = task.get("status")
        print(f"    ... {st} (steps={task.get('stepCount')}, provider={task.get('provider')!r})", flush=True)
        if st in ("completed", "failed", "cancelled"):
            return task
    return {"_timeout": True, "id": tid}

def main():
    import os
    os.makedirs(OUT_DIR, exist_ok=True)
    login = call("POST", "/auth/login", {"email": "admin@constellation.local", "password": "changeme"})
    token = login.get("accessToken")
    if not token:
        print("LOGIN FAILED:", json.dumps(login)[:300])
        sys.exit(1)
    print("login OK")

    cases = [
        ("no-model-default", "v0.3 T8 no-model default", "Say the word 'done'. Do not call any tools.", None),
        ("slash-model-fallback", "v0.3 T8 slash-model fallback", "Say the word 'done'. Do not call any tools.", "openai/gpt-oss-120b"),
        ("local-model-route", "v0.3 T8 local-model route", "Say the word 'done'. Do not call any tools.", "qwen2.5-coder:7b"),
    ]
    results = {}
    for key, title, prompt, model in cases:
        print(f"== {key} ==")
        task = submit_and_poll(token, title, prompt, model)
        results[key] = task
        with open(f"{OUT_DIR}/task8-{key}.json", "w") as f:
            json.dump(task, f, indent=2)
        print(f"  -> {key}: status={task.get('status')} provider={task.get('provider')!r} "
              f"error={task.get('error')!r} steps={task.get('stepCount')}")
        # Print the step skeleton (types only) for quick evidence
        steps = task.get("steps", [])
        print("  steps:", [(s["stepIndex"], s["type"]) for s in steps])

    print("\n=== SUMMARY ===")
    for key, task in results.items():
        print(f"{key}: {task.get('status')} | provider={task.get('provider')!r} | error={task.get('error')!r}")

if __name__ == "__main__":
    main()
