import { Injectable, Logger } from "@nestjs/common";
import type { LoadedPlugin, PluginState } from "@constellation/plugin-sdk";

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

  count(): number {
    return this.plugins.size;
  }
}
