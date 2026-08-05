# Phase 2.0 — OpenTelemetry Tracing: LIVE-PROOF EVIDENCE (2026-08-04)

Round: Phase 2.0 item 2.2 (OTel tracing). Local, $0. Tempo via the federation
overlay (`docker compose -f docker-compose.yml -f docker-compose.federation.yml
--profile federation up -d tempo`), api native on :4001 (`scripts/boot-api-v0.3.sh`).

## HALF A — the no-op invariant (OTEL_EXPORTER_OTLP_ENDPOINT UNSET)

- Boot log (literal): `LOG [TracingService] OpenTelemetry tracing disabled
  (OTEL_EXPORTER_OTLP_ENDPOINT unset) — spans are no-ops`
- Engine task `otel no-op proof` (id cmsehl75w000644fxtxchudqx):
  `status=completed, provider=ollama, stepCount=1` — ZERO behavior change.
- Tempo `/api/search?tags=service.name=constellation-api` (30-min window):
  **0 traces BEFORE and 0 traces AFTER** the task — nothing exported.
- Evidence: `half-a-noop-task.json`.

## HALF B — enabled (OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318)

- Boot log (literal): `LOG [TracingService] OpenTelemetry tracing enabled —
  exporting spans to http://localhost:4318 (service constellation-api)`
- Engine task `otel live proof` (id cmsei6s6n0006t0fx8pockhnl) — the agent
  called a REAL tool (`graphify.graph.query` against the live brain sidecar):
  steps `[(0, tool_call), (1, tool_result), (2, done)]`, `status=completed,
  provider=ollama`.
- Tempo `/api/traces/<id>` (trace b26537cf15da2e83a99e9e1cdbdec8cf), span tree
  with `parentSpanId` links (parenting proven on the wire):

```
engine.task.run                      task.title="otel live proof", task.id=cmsei6s6n…
├─ engine.task.step  (step.index=0)
│   └─ model.call                     gen_ai.provider=ollama, usage 428/58/486 tokens, cost 0
├─ plugin.tool.invoke                 plugin.id=graphify, tool.name=graph.query, tool.outcome=ok
└─ engine.task.step  (step.index=2)
    ├─ model.call                      usage 4078/38/4116 tokens, cost 0
    └─ model.call                      (the 180s-timeout call — no usage; Ollama abort absorbed by bounded retry)
```

- Acceptance: all five required span kinds present in Tempo —
  `http.request`, `engine.task.run`, `engine.task.step`, `model.call`,
  `plugin.tool.invoke`. Every engine span carries `task.id`; tool spans carry
  `plugin.id`/`tool.name`/`tool.outcome`; model spans carry gen_ai usage+cost.
  Args are NEVER attributed (same rule as the audit trail).
- Evidence: `half-b-task.json`, `half-b-rich-trace.json` (full OTLP trace),
  `half-b-tempo-traces.json`, `half-b-verification.json`.
- Verification: `python scripts/verify-otel-evidence.py` → `missing: NONE -
  ACCEPTANCE PASSED`.

## Real bugs found by this live pass (offline gates could NOT catch them)

1. **`import type` erased DI metadata → engine spans silently never created.**
   The three engine services imported `TracingService` as `import type`, so
   tsc dropped the import and `design:paramtypes` became `Function`; Nest's
   `@Optional()` then injected `undefined` — the worker/router/tool spans
   never existed while every gate (incl. the new tracing unit tests, which
   construct with `new`) stayed green. HTTP spans worked (the interceptor
   uses a value import). Fix: value import + `@Optional() @Inject(TracingService)`.
   Same bug class as the `import type` DTO bug (HANDOFF §5-adjacent) — the
   third occurrence in this codebase; worth a sweep.
2. **Tempo `/api/search` takes epoch SECONDS, not nanoseconds** — the driver's
   first search used ns and Tempo rejected it with `value out of range`
   (the spans were there all along; the query was wrong).

## Operational notes

- **PII follow-up (publish-readiness):** span `exception` events embed the full
  Error stack, which carries absolute paths (`C:\Users\<user>\...`) — the
  captured trace JSON leaked the real Windows username and had to be sanitized
  to `<user>` before commit. The platform's own telemetry is local-only, but if
  traces ever leave the host (or the repo goes public), sanitize exception
  stacks at the source (TracingService.recordException wrapper) in a hardening
  round.
- The federation overlay MUST be run as
  `docker compose -f docker-compose.yml -f docker-compose.federation.yml`
  (both files): the overlay alone renders `services: {}` because it references
  the `constellation` network defined in the base file, and containers created
  overlay-alone never publish their ports.
- OTel JS 2.x specifics (all commented in code): sdk-trace-base@2.10 is a
  shim keeping the OLD processor constructor signatures; `SpanExporter.export`
  is callback-based; `ReadableSpan` exposes `parentSpanContext` (not
  `parentSpanId`); `Resource` is built via `resourceFromAttributes`;
  `AsyncLocalStorageContextManager` lives only in the heavy `@opentelemetry/sdk-node`
  → a ~20-line `AlsContextManager` was hand-rolled; `setGlobalTracerProvider`
  is once-per-process (tests call `trace.disable()` between cases).
