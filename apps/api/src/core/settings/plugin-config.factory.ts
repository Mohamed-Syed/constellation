import { Injectable } from "@nestjs/common";
import type { PluginConfig } from "@constellation/plugin-sdk";
import { FeatureFlagService, type FeatureFlagDefault } from "./feature-flag.service.js";
import { SettingsService, type SettingDefault } from "./settings.service.js";

/** The manifest fields needed to build a plugin's `PluginConfig`. */
export interface PluginConfigSource {
  id: string;
  settings: readonly SettingDefault[];
  featureFlags: readonly FeatureFlagDefault[];
}

/**
 * Builds the SDK's `PluginConfig` capability for one plugin, wiring
 * `SettingsService` + `FeatureFlagService` together.
 *
 * Takes the plugin's manifest fields directly (not a lookup via the plugin
 * registry) so this module has zero dependency on `core/plugins/**`, which
 * Nova owns — the caller (wherever `PluginContext` gets built) already has
 * the manifest in hand. See `INTEGRATION_NOTES_ATLAS.md`.
 */
@Injectable()
export class PluginConfigFactory {
  constructor(
    private readonly settings: SettingsService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  /**
   * Hydrates both caches for this plugin (manifest defaults + any DB
   * overrides) and returns a ready-to-use, synchronous `PluginConfig`.
   * Call once per plugin, before handing its `PluginContext` to `register()`.
   */
  async forPlugin(manifest: PluginConfigSource): Promise<PluginConfig> {
    await Promise.all([
      this.settings.hydrate(manifest.id, manifest.settings),
      this.featureFlags.hydrate(manifest.id, manifest.featureFlags),
    ]);

    const pluginId = manifest.id;
    const settings = this.settings;
    const featureFlags = this.featureFlags;

    return {
      get<T = unknown>(key: string): T | undefined {
        return settings.get<T>(pluginId, key);
      },
      getOrThrow<T = unknown>(key: string): T {
        const value = settings.get<T>(pluginId, key);
        if (value === undefined) {
          throw new Error(`Setting "${key}" is not set for plugin "${pluginId}"`);
        }
        return value;
      },
      isFeatureEnabled(flag: string): boolean {
        return featureFlags.isEnabled(pluginId, flag);
      },
    };
  }
}
