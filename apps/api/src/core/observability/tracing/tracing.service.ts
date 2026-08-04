import { Injectable, Logger, Optional } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { context, trace, type Attributes, type Span, SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { AlsContextManager } from "./als-context-manager.js";

/**
 * Tracing options. All optional — production wiring passes nothing and the
 * service reads the environment; tests pass a fake exporter + a synchronous
 * processor so they exercise the real span lifecycle with NO network and NO
 * SDK start (the `new`-construction discipline of this codebase).
 */
export interface TracingOptions {
  /** OTLP/HTTP endpoint, e.g. `http://localhost:4318` or `…/v1/traces`. */
  endpoint?: string;
  /** OTEL_SERVICE_NAME — resource attribute; default `constellation-api`. */
  serviceName?: string;
  /** Explicit enable/disable override (default: `endpoint` is set). */
  enabled?: boolean;
  /** Test seam — a fake exporter (never used in production wiring). */
  exporter?: SpanExporter;
  /** Test seam — a synchronous processor (production uses BatchSpanProcessor). */
  processor?: SpanProcessor;
}

/** DI token so `@Optional() @Inject(TRACING_OPTIONS)` never breaks Nest at boot. */
export const TRACING_OPTIONS = Symbol("TRACING_OPTIONS");

/** A started-but-not-yet-ended span handle (HTTP interceptor use). */
export interface SpanHandle {
  /** End the span, attaching final attributes (e.g. the response status). */
  end(extraAttributes?: Attributes): void;
  /** Mark the span errored (records the exception on the span). */
  setError(err: unknown): void;
}

/**
 * OpenTelemetry tracing service (Phase 2.0 — "Production Foundation").
 *
 * FULLY ADDITIVE, THE INVARIANT: when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset
 * (the default) this service is a NO-OP — it never constructs the SDK, never
 * opens a socket, and `withSpan`/`startSpan` run the caller's function
 * unchanged with zero overhead. Only when an endpoint is configured does it
 * build a TracerProvider + BatchSpanProcessor + OTLP exporter, register the
 * provider globally, and start exporting spans (HTTP requests, engine task
 * runs/steps, model calls, plugin tool invocations).
 *
 * `withSpan` activates the span in the OTel context (AsyncLocalStorage), so
 * nested spans parent correctly: engine.task.run -> engine.task.step ->
 * model.call / plugin.tool.invoke.
 *
 * A bad endpoint must never take the app down: any construction/export error
 * degrades to the no-op path with an honest warning.
 */
@Injectable()
export class TracingService {
  private readonly logger = new Logger(TracingService.name);
  private enabled = false;
  private tracerProvider: BasicTracerProvider | null = null;
  private processor: SpanProcessor | null = null;
  private readonly endpoint: string | undefined;
  private readonly serviceName: string;

  constructor(
    config: ConfigService,
    @Optional() @Inject(TRACING_OPTIONS) private readonly options?: Partial<TracingOptions>,
  ) {
    this.endpoint = options?.endpoint ?? config.get<string>("OTEL_EXPORTER_OTLP_ENDPOINT") ?? undefined;
    this.serviceName = options?.serviceName ?? config.get<string>("OTEL_SERVICE_NAME") ?? "constellation-api";

    const explicit = options?.enabled ?? parseBool(config.get<string>("OTEL_TRACES_ENABLED"));
    if (explicit === false) {
      this.logger.warn("OpenTelemetry tracing disabled (OTEL_TRACES_ENABLED=false)");
      return;
    }
    if (!this.endpoint) {
      this.logger.log(
        "OpenTelemetry tracing disabled (OTEL_EXPORTER_OTLP_ENDPOINT unset) — spans are no-ops",
      );
      return;
    }
    try {
      this.startSdk();
    } catch (err) {
      this.enabled = false;
      this.tracerProvider = null;
      this.processor = null;
      this.logger.error(
        `OpenTelemetry tracing failed to start (${err instanceof Error ? err.message : String(err)}) — continuing WITHOUT tracing`,
      );
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Flush pending spans (tests + graceful shutdown call this). */
  async flush(): Promise<void> {
    if (!this.processor) return;
    try {
      await this.processor.forceFlush();
    } catch (err) {
      this.logger.warn(`Tracing flush failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Shut the SDK down (flushes + stops timers). No-op when never started. */
  async shutdown(): Promise<void> {
    if (this.tracerProvider) {
      try {
        await this.tracerProvider.shutdown();
      } catch (err) {
        this.logger.warn(`Tracing shutdown failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.tracerProvider = null;
      this.processor = null;
      this.enabled = false;
    }
  }

  /**
   * Run `fn` inside a span of `name` with `attributes`. When tracing is
   * disabled this is exactly `await fn()` — zero overhead, no span created.
   * The span is activated in the OTel context, so spans created inside `fn`
   * (model calls, tool invokes) parent under it. `fn` receives the span so
   * callers can attach post-hoc attributes (e.g. usage). Errors are recorded
   * on the span (ERROR status + exception) and rethrown — behavior unchanged.
   */
  async withSpan<T>(name: string, attributes: Attributes, fn: (span: Span) => Promise<T>): Promise<T> {
    if (!this.enabled) return fn(undefined as unknown as Span);
    const span = this.tracer().startSpan(name, { attributes });
    const ctx = trace.setSpan(context.active(), span);
    try {
      return await context.with(ctx, () => fn(span));
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  }

  /**
   * Start a span without ending it (HTTP interceptor pattern: the span must
   * live across the observable). Returns null when tracing is disabled —
   * callers treat null as "nothing to do". The span is NOT activated in the
   * context (the interceptor has no async child spans to parent).
   */
  startSpan(name: string, attributes?: Attributes): SpanHandle | null {
    if (!this.enabled) return null;
    const span = this.tracer().startSpan(name, { attributes });
    return {
      end: (extra?: Attributes) => {
        if (extra) span.setAttributes(extra);
        span.end();
      },
      setError: (err: unknown) => {
        span.recordException(err instanceof Error ? err : new Error(String(err)));
        span.setStatus({ code: SpanStatusCode.ERROR });
      },
    };
  }

  private tracer() {
    return trace.getTracer(this.serviceName);
  }

  private startSdk(): void {
    const resource = resourceFromAttributes({ [SEMRESATTRS_SERVICE_NAME]: this.serviceName });
    const exporter: SpanExporter = this.options?.exporter ?? new OTLPTraceExporter({ url: otlpTracesUrl(this.endpoint!) });
    // Tests inject a synchronous processor; production batches (default 5s).
    // NOTE: @opentelemetry/sdk-trace-base 2.x is a shim that keeps the OLD
    // constructor signatures (exporter passed directly, not { exporter }).
    this.processor = this.options?.processor ?? new BatchSpanProcessor(exporter);
    const provider = new BasicTracerProvider({ resource, spanProcessors: [this.processor] });
    // Context propagation (parent-child spans across awaits) needs a real
    // context manager — the api default is a noop. Register OUR AsyncLocalStorage
    // manager (the OTel one lives in the heavy @opentelemetry/sdk-node).
    context.setGlobalContextManager(new AlsContextManager());
    trace.setGlobalTracerProvider(provider);
    this.tracerProvider = provider;
    this.enabled = true;
    this.logger.log(
      `OpenTelemetry tracing enabled — exporting spans to ${this.endpoint} (service ${this.serviceName})`,
    );
  }
}

/** Normalize an OTLP endpoint to the traces URL: base `http://h:4318` → `http://h:4318/v1/traces`. */
function otlpTracesUrl(endpoint: string): string {
  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  return base.endsWith("/v1/traces") ? base : `${base}/v1/traces`;
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return !/^(0|false|no|off)$/i.test(value);
}
