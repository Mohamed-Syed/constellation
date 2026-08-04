import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";

import { MetricsService } from "./metrics/metrics.service.js";
import { MetricsController } from "./metrics/metrics.controller.js";
import { HttpMetricsInterceptor } from "./metrics/http-metrics.interceptor.js";
import { MetricsEngineBridge } from "./metrics/engine-metrics-bridge.js";
import { TracingService } from "./tracing/tracing.service.js";
import { HttpTracingInterceptor } from "./tracing/http-tracing.interceptor.js";

/**
 * Observability module (Phase 2.0 — "Production Foundation").
 *
 * Wires the Prometheus metrics service + HTTP interceptor + engine bridge,
 * and the OpenTelemetry tracing service + HTTP interceptor.
 * Exporting `MetricsService` / `TracingService` lets other modules (engine,
 * auth) `@Optional()` inject them to record model/task/plugin/auth metrics
 * and spans without coupling.
 *
 * ADDITIVE: metrics are process-local and opt-out via `METRICS_ENABLED=false`;
 * tracing no-ops entirely when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset.
 * Nothing here changes runtime behavior.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    MetricsEngineBridge,
    TracingService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpTracingInterceptor,
    },
  ],
  exports: [MetricsService, TracingService],
})
export class ObservabilityModule {}
