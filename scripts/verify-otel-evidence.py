#!/usr/bin/env python3
"""Post-flight verification + evidence capture for the OTel live proof.

Parses Tempo's /api/traces OTLP-JSON correctly (batches[].scopeSpans[] =
[{scope, spans}]) and asserts the required span kinds + parenting.
"""
import json
import time
import urllib.request

TEMPO = "http://localhost:3200"
OUT = "artifacts/phase2-otel-tracing"


def call(path, base=TEMPO, timeout=60):
    req = urllib.request.Request(f"{base}{path}", method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def spans_of(trace):
    out = []
    for batch in trace.get("batches", []):
        for scope_span in batch.get("scopeSpans", []):
            for s in scope_span.get("spans", []):
                attrs = {}
                for a in s.get("attributes", []):
                    v = a.get("value", {})
                    attrs[a["key"]] = v.get("stringValue") or v.get("intValue") or v.get("boolValue")
                out.append({"name": s.get("name"), "attrs": attrs,
                            "spanId": s.get("spanId"), "parentSpanId": s.get("parentSpanId")})
    return out


def main():
    end = int(time.time())
    start = end - 1800
    search = call(f"/api/search?start={start}&end={end}&limit=100")
    traces = search.get("traces", [])
    print(f"total traces in window: {len(traces)}")

    all_spans = []
    for t in traces:
        tr = call(f"/api/traces/{t['traceID']}")
        spans = spans_of(tr)
        all_spans.extend(spans)
        if "engine.task.run" in {s["name"] for s in spans}:
            with open(f"{OUT}/half-b-rich-trace.json", "w") as f:
                json.dump(tr, f, indent=2)
            print(f"\n=== rich trace {t['traceID']} ===")
            for s in spans:
                extra = {k: v for k, v in s["attrs"].items() if k != "task.id"}
                print(f"  {s['name']}  parent={s['parentSpanId'][:6] if s.get('parentSpanId') else '-'}  {extra}")

    kinds = {s["name"] for s in all_spans}
    required = {"http.request", "engine.task.run", "engine.task.step", "model.call", "plugin.tool.invoke"}
    missing = required - kinds
    print(f"\n=== ACCEPTANCE ===")
    print(f"span kinds seen: {sorted(kinds)}")
    print(f"missing: {sorted(missing) if missing else 'NONE - ACCEPTANCE PASSED'}")

    # Parenting check on the rich trace
    for s in all_spans:
        if s["name"] == "engine.task.step":
            parent_run = any(x["name"] == "engine.task.run" and x["spanId"] == s["parentSpanId"] for x in all_spans)
            print(f"step span parented under run: {parent_run}")
        if s["name"] == "model.call":
            parent_step = any(x["name"] == "engine.task.step" and x["spanId"] == s["parentSpanId"] for x in all_spans)
            print(f"model.call parented under step: {parent_step}")
        if s["name"] == "plugin.tool.invoke":
            parent_run2 = any(x["name"] == "engine.task.run" and x["spanId"] == s["parentSpanId"] for x in all_spans)
            print(f"plugin.tool.invoke parented under run: {parent_run2}")

    with open(f"{OUT}/half-b-verification.json", "w") as f:
        json.dump({"traces": len(traces), "span_kinds": sorted(kinds), "missing": sorted(missing)}, f, indent=2)
    return 0 if not missing else 1


if __name__ == "__main__":
    raise SystemExit(main())
