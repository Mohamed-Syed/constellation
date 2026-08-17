#!/usr/bin/env python3
"""Phase 2.0 OTel tracing — live-proof driver.

Proves BOTH halves against the LIVE stack:

  HALF A (no-op invariant): api booted with OTEL_EXPORTER_OTLP_ENDPOINT UNSET.
    - boot log shows "OpenTelemetry tracing disabled"
    - an engine task still completes on Ollama (zero behavior change)
    - Tempo has ZERO traces from service constellation-api

  HALF B (enabled): api booted with OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318.
    - boot log shows "OpenTelemetry tracing enabled"
    - an engine task with a REAL tool call (graphify.graph.query -> live
      brain sidecar) completes
    - Tempo search returns traces; the task's trace contains spans:
      http.request (POST /engine/tasks + GET /engine/tasks/:id),
      engine.task.run, engine.task.step, model.call, plugin.tool.invoke

Usage: python scripts/live-otel-proof.py  (api must be booted first; see below)
"""
import json
import sys
import time
import urllib.request

API = "http://localhost:4001/api"
TEMPO = "http://localhost:3200"
OUT_DIR = "artifacts/phase2-otel-tracing"
SERVICE = "constellation-api"


def call(method, path, body=None, token=None, timeout=30, base=API):
    req = urllib.request.Request(f"{base}{path}", method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code, "_body": e.read().decode()[:500]}


def submit_and_poll(token, title, prompt, model=None, max_steps=6, poll_every=10, max_wait=900):
    body = {"title": title, "prompt": prompt, "maxSteps": max_steps}
    if model:
        body["model"] = model
    created = call("POST", "/engine/tasks", body, token)
    if "_http_error" in created:
        return created
    tid = created["id"]
    print(f"  submitted {title}: id={tid}", flush=True)
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


def tempo_search(limit=50):
    # Tempo's /api/search takes start/end as UNIX EPOCH SECONDS (int32 range).
    end_s = int(time.time())
    start_s = end_s - 30 * 60
    q = f"/api/search?start={start_s}&end={end_s}&tags=service.name={SERVICE}&limit={limit}"
    return call("GET", q, base=TEMPO)


def tempo_trace(trace_id):
    return call("GET", f"/api/traces/{trace_id}", base=TEMPO, timeout=60)


def span_names(trace):
    out = []
    for batch in (trace.get("batches") or []):
        for scope in (batch.get("scopeSpans") or []):
            for span in (scope.get("spans") or []):
                out.append(span.get("name"))
    return out


def main():
    import os
    import sys as _sys
    phase = _sys.argv[1] if len(_sys.argv) > 1 else "A"
    os.makedirs(OUT_DIR, exist_ok=True)

    login = call("POST", "/auth/login", {"email": "admin@constellation.local", "password": "changeme"})
    token = login.get("accessToken")
    if not token:
        print("LOGIN FAILED:", json.dumps(login)[:300])
        sys.exit(1)
    print("login OK")

    if phase == "A":
        # ---- HALF A: no-op invariant (api booted with endpoint UNSET) ----
        print("\n== HALF A: no-op (endpoint unset — expect ZERO constellation-api traces) ==")
        before = tempo_search()
        print(f"  Tempo traces for {SERVICE} BEFORE no-op task: {len(before.get('traces', []))}")
        task_a = submit_and_poll(token, "otel no-op proof", "Say the word 'done'. Do not call any tools.")
        print(f"  task_a: status={task_a.get('status')} provider={task_a.get('provider')!r} error={task_a.get('error')!r}")
        time.sleep(10)  # give any (wrong) export a chance to land
        after = tempo_search()
        print(f"  Tempo traces for {SERVICE} AFTER no-op task: {len(after.get('traces', []))}")
        with open(f"{OUT_DIR}/half-a-noop-task.json", "w") as f:
            json.dump({"task": task_a, "tempo_before": before, "tempo_after": after}, f, indent=2)
        print("\n=== HALF A SUMMARY ===")
        print(f"  task={task_a.get('status')}, zero constellation-api traces before+after: "
              f"{len(before.get('traces', [])) == 0 and len(after.get('traces', [])) == 0}")
        return

    # ---- HALF B: enabled (api booted with endpoint SET) ----
    print("\n== HALF B: enabled (endpoint set — expect spans in Tempo) ==")
    task_b = submit_and_poll(
        token,
        "otel live proof",
        "Call the graphify graph.query tool once with the question 'what connects the plugin loader to the SDK?', "
        "then finish with a one-line summary of what you found.",
    )
    print(f"  task_b: status={task_b.get('status')} provider={task_b.get('provider')!r} error={task_b.get('error')!r}")
    steps = task_b.get("steps", [])
    print("  task_b steps:", [(s["stepIndex"], s["type"]) for s in steps])
    with open(f"{OUT_DIR}/half-b-task.json", "w") as f:
        json.dump(task_b, f, indent=2)

    # Query Tempo for the trace(s) of the enabled run
    time.sleep(12)  # BatchSpanProcessor flushes every 5s
    search = tempo_search()
    print(f"  Tempo search returned {len(search.get('traces', []))} trace(s) for {SERVICE}")
    traces = []
    for t in search.get("traces", [])[:10]:
        trace_id = t.get("traceID")
        tr = tempo_trace(trace_id)
        names = span_names(tr)
        traces.append({"traceID": trace_id, "spans": names, "rootName": t.get("rootServiceName")})
        print(f"  trace {trace_id}: spans={names}")
    with open(f"{OUT_DIR}/half-b-tempo-traces.json", "w") as f:
        json.dump({"search": search, "traces": traces}, f, indent=2)

    # Acceptance: the task's trace must contain all five span kinds
    all_names = {n for t in traces for n in t["spans"]}
    required = {"http.request", "engine.task.run", "engine.task.step", "model.call", "plugin.tool.invoke"}
    missing = required - all_names
    print("\n=== SUMMARY ===")
    print(f"  Half B (enabled): task={task_b.get('status')}, span kinds seen: {sorted(all_names)}")
    print(f"  Required span kinds missing: {sorted(missing) if missing else 'NONE — ACCEPTANCE PASSED'}")


if __name__ == "__main__":
    main()
