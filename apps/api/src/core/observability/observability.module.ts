import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";

import { MetricsService } from "./metrics/metrics.service.js";
import { MetricsController } from "./metrics/metrics.controller.js";
import { HttpMetricsInterceptor } from "./metrics/http-metrics.interceptor.js";
import { MetricsEngineBridge } from "./metrics/engine-metrics-bridge.js";

/**
 * Observability module (Phase 2.0 — "Production Foundation").
 *
 * Wires the Prometheus metrics service + HTTP interceptor + engine bridge.
 * Exporting `MetricsService` lets other modules (engine, auth) `@Optional()`
 * inject it to record model/task/plugin/auth metrics without coupling.
 *
 * ADDITIVE: metrics are process-local and opt-out via `METRICS_ENABLED=false`;
 * nothing here changes runtime behavior.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    MetricsEngineBridge,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },
  ],
  exports: [MetricsService],
})
export class ObservabilityModule {}
