import { EventEmitter } from "node:events";
import { Injectable, Logger } from "@nestjs/common";
import type { PluginEvents } from "@constellation/plugin-sdk";

const PLATFORM_NAMESPACE = "platform";

/**
 * Scoped event bus backing the SDK's `PluginEvents`. Topics a plugin emits
 * or subscribes to via `emit`/`on` are automatically namespaced to that
 * plugin (`<pluginId>:<topic>`), so two plugins can both use a topic name
 * like `"item.created"` without colliding. `onPlatform` subscribes to
 * platform-wide topics instead (`platform:<topic>`), published via
 * `emitPlatform` by core services (e.g. `plugin:enabled`, `plugin:disabled`
 * — the plugin-loader wiring covers exactly
 * which topics the loader should publish).
 *
 * TODO: RabbitMQ — this is an in-process `EventEmitter` today, which is
 * fine while every plugin runs in the same Node process as the core. Once
 * plugins can run as separate services (the SDK's `PluginContext` is
 * explicitly designed so the context "becomes an RPC stub" later), swap
 * this class's internals for an amqplib/amqp-connection-manager-backed
 * transport. `PluginEvents` (emit/on/onPlatform) is the stable surface;
 * nothing outside this file should need to change.
 */
@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);
  private readonly emitter = new EventEmitter();

  constructor() {
    // Many plugins × many topics is expected; don't warn on listener count.
    this.emitter.setMaxListeners(0);
  }

  /** Build the namespaced `PluginEvents` capability for one plugin. */
  forPlugin(pluginId: string): PluginEvents {
    return {
      emit: (topic, payload) => {
        this.emitter.emit(this.pluginTopic(pluginId, topic), payload);
      },
      on: (topic, handler) => {
        const full = this.pluginTopic(pluginId, topic);
        this.emitter.on(full, this.safeHandler(full, handler));
      },
      onPlatform: (topic, handler) => {
        const full = `${PLATFORM_NAMESPACE}:${topic}`;
        this.emitter.on(full, this.safeHandler(full, handler));
      },
    };
  }

  /** Publish a platform-wide event. Plugins receive it via `onPlatform`. */
  emitPlatform(topic: string, payload: unknown): void {
    this.emitter.emit(`${PLATFORM_NAMESPACE}:${topic}`, payload);
  }

  private pluginTopic(pluginId: string, topic: string): string {
    return `${pluginId}:${topic}`;
  }

  /** Isolation: a throwing/rejecting handler logs and never takes down the emitter or other listeners. */
  private safeHandler(topic: string, handler: (payload: unknown) => void | Promise<void>) {
    return (payload: unknown): void => {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            this.logger.error(`Handler for "${topic}" rejected: ${asMessage(err)}`);
          });
        }
      } catch (err) {
        this.logger.error(`Handler for "${topic}" threw: ${asMessage(err)}`);
      }
    };
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
