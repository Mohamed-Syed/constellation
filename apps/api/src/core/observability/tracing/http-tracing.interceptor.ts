import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { TracingService } from "./tracing.service.js";

/**
 * Global HTTP tracing interceptor (Phase 2.0 — OpenTelemetry).
 *
 * Emits one `http.request` span per request (method, route, status, duration)
 * when tracing is enabled; when the endpoint is unset the TracingService
 * returns null and this interceptor is a pure passthrough. Purely additive —
 * never modifies the request or response. Registered via APP_INTERCEPTOR in
 * ObservabilityModule alongside the HTTP metrics interceptor.
 *
 * The route resolution mirrors HttpMetricsInterceptor (low-cardinality route
 * bucket: Express route path → `<controller>.<method>` → raw URL).
 */
@Injectable()
export class HttpTracingInterceptor implements NestInterceptor {
  constructor(private readonly tracing: TracingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }
    const startedAt = Date.now();
    const request = context.switchToHttp().getRequest<{ method?: string; url?: string; route?: { path?: string } }>();
    const method = request?.method ?? "UNKNOWN";
    const route = this.resolveRoute(context, request?.route?.path);

    const handle = this.tracing.startSpan("http.request", {
      "http.request.method": method,
      "http.route": route,
      "url.path": route,
    });
    if (!handle) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => this.finish(context, handle, startedAt),
        error: (err: unknown) => {
          handle.setError(err);
          this.finish(context, handle, startedAt, 500);
        },
      }),
    );
  }

  private finish(context: ExecutionContext, handle: { end(extra?: Record<string, string | number>): void }, startedAt: number, fallbackStatus?: number): void {
    try {
      const response = context.switchToHttp().getResponse<{ statusCode?: number }>();
      handle.end({
        "http.response.status_code": response?.statusCode ?? fallbackStatus ?? 200,
        "constellation.duration_ms": Date.now() - startedAt,
      });
    } catch {
      handle.end({ "http.response.status_code": fallbackStatus ?? 500, "constellation.duration_ms": Date.now() - startedAt });
    }
  }

  private resolveRoute(context: ExecutionContext, routePath: string | undefined): string {
    if (routePath) return routePath;
    try {
      const handler = context.getClass();
      const methodName = context.getHandler().name ?? "";
      if (handler && typeof handler === "function") {
        return `${handler.name}.${methodName}`;
      }
    } catch {
      /* fall through */
    }
    try {
      const req = context.switchToHttp().getRequest<{ url?: string }>();
      if (req?.url) return req.url;
    } catch {
      /* no request */
    }
    return "unknown";
  }
}
