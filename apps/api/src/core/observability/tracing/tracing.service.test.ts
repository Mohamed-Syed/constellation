import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigService } from "@nestjs/config";
import { trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { TracingService } from "./tracing.service.js";

/** Config stub in the codebase's `new`-construction style. */
function config(overrides: Record<string, string | undefined> = {}): ConfigService {
  return {
    get: (k: string, d?: string) => overrides[k] ?? d,
  } as unknown as ConfigService;
}

describe("TracingService — disabled (the default; SDK never started)", () => {
  it("is disabled when OTEL_EXPORTER_OTLP_ENDPOINT is unset", () => {
    const svc = new TracingService(config({}));
    expect(svc.isEnabled).toBe(false);
  });

  it("is disabled when OTEL_TRACES_ENABLED=false even with an endpoint", () => {
    const svc = new TracingService(config({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318", OTEL_TRACES_ENABLED: "false" }));
    expect(svc.isEnabled).toBe(false);
  });

  it("withSpan runs the function unchanged and returns its value", async () => {
    const svc = new TracingService(config({}));
    const result = await svc.withSpan("engine.task.run", { "task.id": "t1" }, async () => 42);
    expect(result).toBe(42);
  });

  it("hands the callback a NO-OP span when disabled — a caller attaching usage attrs must not crash (DeepSeek-round regression)", async () => {
    // Found LIVE in the DeepSeek round: withSpan's disabled path used to pass
    // `undefined`; ModelRouterService's span callback dereferenced it
    // (span.setAttributes) on the first model call carrying usage, so EVERY
    // task failed with "Cannot read properties of undefined" whenever
    // OTEL_EXPORTER_OTLP_ENDPOINT was unset (the default). The disabled
    // contract is a no-op span, not undefined.
    const svc = new TracingService(config({}));
    let seen: { setAttributes: unknown } | undefined;
    await svc.withSpan("model.call", { "gen_ai.provider": "deepseek" }, async (span) => {
      seen = span as unknown as { setAttributes: unknown };
      // Exactly what ModelRouterService.chat() does when usage is present:
      span.setAttributes({ "gen_ai.usage.cost_usd": 0.0001 });
      return "ok";
    });
    expect(seen).toBeDefined();
    expect(typeof seen?.setAttributes).toBe("function");
  });

  it("startSpan returns null when disabled (interceptor passthrough)", () => {
    const svc = new TracingService(config({}));
    expect(svc.startSpan("http.request")).toBeNull();
  });

  it("flush is a safe no-op", async () => {
    const svc = new TracingService(config({}));
    await expect(svc.flush()).resolves.toBeUndefined();
  });
});

describe("TracingService — enabled (InMemorySpanExporter, no network)", () => {
  let exporter: InMemorySpanExporter;
  let svc: TracingService;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    svc = new TracingService(config({}), {
      endpoint: "http://localhost:4318",
      exporter,
      // Synchronous processor: spans export immediately on end — no timers.
      processor: new SimpleSpanProcessor(exporter),
    });
  });

  afterEach(async () => {
    await svc.flush();
    // OTel's global tracer provider registration is once-per-process: without
    // this, only the FIRST test's TracingService would be the global provider
    // and every later test's spans would export to its discarded exporter.
    trace.disable();
  });

  it("is enabled and exports a completed span through withSpan", async () => {
    expect(svc.isEnabled).toBe(true);
    await svc.withSpan("model.call", { "gen_ai.provider": "ollama", "gen_ai.request.model": "qwen2.5-coder:7b" }, async () => "ok");
    expect(exporter.getFinishedSpans()).toHaveLength(1);
    const span = exporter.getFinishedSpans()[0]!;
    expect(span.name).toBe("model.call");
    expect(span.attributes["gen_ai.provider"]).toBe("ollama");
    expect(span.attributes["gen_ai.request.model"]).toBe("qwen2.5-coder:7b");
  });

  it("marks a throwing fn's span ERROR and rethrows", async () => {
    await expect(
      svc.withSpan("plugin.tool.invoke", { "plugin.id": "graphify", "tool.name": "graph.query" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const span = exporter.getFinishedSpans()[0]!;
    expect(span.status.code).toBe(2); // SpanStatusCode.ERROR
    expect(String(span.status.message)).toContain("boom");
    expect(span.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("nests child spans under the parent (context propagation)", async () => {
    await svc.withSpan("engine.task.run", { "task.id": "t1" }, async () => {
      await svc.withSpan("engine.task.step", { "step.index": "0" }, async () => {
        await svc.withSpan("model.call", { "gen_ai.provider": "ollama" }, async () => "x");
      });
    });
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(3);
    const run = spans.find((s) => s.name === "engine.task.run")!;
    const step = spans.find((s) => s.name === "engine.task.step")!;
    const model = spans.find((s) => s.name === "model.call")!;
    // OTel JS 2.x exposes the parent as parentSpanContext (1.x had parentSpanId).
    expect(step.parentSpanContext?.spanId).toBe(run.spanContext().spanId);
    expect(model.parentSpanContext?.spanId).toBe(step.spanContext().spanId);
  });

  it("startSpan returns a handle whose end() exports the span", async () => {
    const handle = svc.startSpan("http.request", { "http.request.method": "GET", "http.route": "/api/health" });
    expect(handle).not.toBeNull();
    handle!.end({ "http.response.status_code": 200, "constellation.duration_ms": 3 });
    expect(exporter.getFinishedSpans()).toHaveLength(1);
    expect(exporter.getFinishedSpans()[0]!.attributes["http.response.status_code"]).toBe(200);
  });

  it("startSpan handle setError marks ERROR", () => {
    const handle = svc.startSpan("http.request")!;
    handle.setError(new Error("upstream 500"));
    handle.end();
    expect(exporter.getFinishedSpans()[0]!.status.code).toBe(2);
  });

  it("honors the service name resource attribute", async () => {
    // A second service in the same test: reset the once-per-process global
    // provider so svc2's registration (and resource) actually takes effect.
    trace.disable();
    const svc2 = new TracingService(config({}), {
      serviceName: "constellation-api-test",
      endpoint: "http://localhost:4318",
      exporter,
      processor: new SimpleSpanProcessor(exporter),
    });
    await svc2.withSpan("http.request", {}, async () => "x");
    expect(exporter.getFinishedSpans()[0]!.resource.attributes["service.name"]).toBe("constellation-api-test");
  });

  it("degrades to disabled when the SDK construction throws (never crashes)", () => {
    // A throwing getter forces the failure INSIDE startSdk (the construction
    // of the processor), which is the seam the try/catch protects.
    const options = {
      endpoint: "http://localhost:4318",
      get processor(): SpanProcessor {
        throw new Error("boom");
      },
    };
    const svc2 = new TracingService(config({}), options);
    expect(svc2.isEnabled).toBe(false);
  });
});
