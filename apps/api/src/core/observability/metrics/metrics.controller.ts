import { Controller, Get, Header } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "../../auth/public.decorator.js";
import { MetricsService } from "./metrics.service.js";
import { MetricsEngineBridge } from "./engine-metrics-bridge.js";

/**
 * Prometheus metrics endpoint (Phase 2.0).
 *
 * GET /api/metrics — the Prometheus text exposition format (v0.0.4) that the
 * compose stack's Prometheus scrapes (see infra/prometheus/prometheus.yml,
 * job `constellation-api`). `@Public()` so the scraper needs no auth. No
 * gzip: Prometheus prefers identity encoding on the scrape path.
 *
 * Before rendering, refreshes the engine snapshot gauges from the engine's
 * health endpoints (MetricsEngineBridge), so the /metrics output reflects the
 * current queue/scheduler/supervisor/alert state without the engine services
 * needing to know about metrics at all.
 */
@ApiExcludeController()
@Controller("metrics")
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly bridge: MetricsEngineBridge,
  ) {}

  @Public()
  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  async index(): Promise<string> {
    try {
      await this.bridge.refresh(this.metrics);
    } catch {
      // The bridge already swallows per-source errors; this is a last-resort
      // guard so a broken scrape never 500s Prometheus.
    }
    return this.metrics.render();
  }
}
