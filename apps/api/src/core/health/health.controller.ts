import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PLATFORM_VERSION } from "@constellation/plugin-sdk";
import { PluginRegistryService } from "../plugins/plugin-registry.service.js";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly registry: PluginRegistryService) {}

  @Get()
  health() {
    const plugins = this.registry.all();
    const summary = this.registry.summary();
    // "ok" only when nothing failed to load AND nothing is reporting
    // degraded/down health (Nova's health poller feeds `degradedOrDown`).
    const status = summary.failed === 0 && summary.degradedOrDown === 0 ? "ok" : "degraded";
    return {
      status,
      platformVersion: PLATFORM_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      plugins: {
        total: summary.total,
        failed: summary.failed,
        enabled: summary.enabled,
        disabled: summary.disabled,
        degradedOrDown: summary.degradedOrDown,
        ids: plugins.map((p) => ({
          id: p.manifest.id,
          state: p.state,
          health: p.health?.status ?? null,
        })),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
