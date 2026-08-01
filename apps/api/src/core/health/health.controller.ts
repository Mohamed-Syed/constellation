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
    const failed = plugins.filter((p) => p.state === "failed");
    return {
      status: failed.length === 0 ? "ok" : "degraded",
      platformVersion: PLATFORM_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      plugins: {
        total: plugins.length,
        failed: failed.length,
        ids: plugins.map((p) => ({ id: p.manifest.id, state: p.state })),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
