import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { MetricsService } from "./metrics.service.js";

/**
 * Global HTTP metrics interceptor (Phase 2.0 — Prometheus).
 *
 * Wraps every request, records a counter by method/route/status-class and a
 * latency histogram, then lets the response proceed — purely additive, never
 * modifies the request or response. Registered via APP_INTERCEPTOR in
 * ObservabilityModule.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(
    private readonly metrics: MetricsService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }
    const startedAt = Date.now();
    const request = context.switchToHttp().getRequest();
    const method = (request?.method as string | undefined) ?? "UNKNOWN";
    const route = this.resolveRoute(context, request?.route?.path);

    return next.handle().pipe(
      tap({
        next: () => this.record(context, method, route, startedAt),
        error: () => this.record(context, method, route, startedAt),
      }),
    );
  }

  private record(context: ExecutionContext, method: string, route: string, startedAt: number): void {
    try {
      const response = context.switchToHttp().getResponse();
      const status = (response?.statusCode as number | undefined) ?? 200;
      this.metrics.recordHttpRequest(method, route, status, Date.now() - startedAt);
    } catch {
      this.metrics.recordHttpRequest(method, route, 500, Date.now() - startedAt);
    }
  }

  /**
   * Resolve a stable route label. Express sets `request.route?.path` only for
   * route handlers (not for 404s), and it gives the Nest route plus method. We
   * fall back to `<controller>.<method>` from ExecutionContext's handler, then
   * to the raw URL path. The goal is a low-cardinality route bucket for Prometheus.
   */
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
