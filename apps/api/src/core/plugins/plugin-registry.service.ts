import { Injectable, Logger } from "@nestjs/common";
import type { HealthResult, LoadedPlugin, PluginState } from "@constellation/plugin-sdk";

/**
 * In-memory registry of every loaded plugin. Single source of truth for the
 * running process; the admin API and portal read from here. Persistence of
 * enabled/disabled state (per environment/tenant) is added with the DB layer.
 */
@Injectable()
export class PluginRegistryService {
  private readonly logger = new Logger(PluginRegistryService.name);
  private readonly plugins = new Map<string, LoadedPlugin>();

  register(plugin: LoadedPlugin): void {
    if (this.plugins.has(plugin.manifest.id)) {
      this.logger.warn(`Plugin "${plugin.manifest.id}" already registered — overwriting`);
    }
    this.plugins.set(plugin.manifest.id, plugin);
  }

  get(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id);
  }

  all(): LoadedPlugin[] {
    return [...this.plugins.values()];
  }

  byState(state: PluginState): LoadedPlugin[] {
    return this.all().filter((p) => p.state === state);
  }

  setState(id: string, state: PluginState, error?: string): void {
    const p = this.plugins.get(id);
    if (!p) return;
    p.state = state;
    p.error = error;
  }

  /** Record the result of a `health()` poll against a plugin. */
  setHealth(id: string, health: HealthResult): void {
    const p = this.plugins.get(id);
    if (!p) return;
    p.health = health;
    p.healthCheckedAt = new Date().toISOString();
  }

  count(): number {
    return this.plugins.size;
  }

  /**
   * Aggregate view for `GET /api/health`. Kept here (rather than in the health
   * module, which Nova doesn't own) as the seam: the health controller should
   * fold `degradedOrDown` into its overall status alongside `failed`, e.g.
   * `status: failed === 0 && degradedOrDown === 0 ? "ok" : "degraded"`.
   */
  summary(): {
    total: number;
    failed: number;
    enabled: number;
    disabled: number;
    degradedOrDown: number;
  } {
    const all = this.all();
    return {
      total: all.length,
      failed: all.filter((p) => p.state === "failed").length,
      enabled: all.filter((p) => p.state === "enabled").length,
      disabled: all.filter((p) => p.state === "disabled").length,
      degradedOrDown: all.filter((p) => p.health && p.health.status !== "ok").length,
    };
  }
}
