import { definePlugin, type HealthResult, type PluginContext } from "@constellation/plugin-sdk";

/**
 * The Hello World plugin. Demonstrates the minimum a plugin needs: implement
 * the lifecycle hooks you care about, use only the PluginContext, and stay
 * isolated. The manifest (plugin.manifest.json) declares the rest.
 */
export default definePlugin({
  register(ctx: PluginContext): void {
    ctx.logger.info("hello-world registered");
  },

  enable(ctx: PluginContext): void {
    const name = ctx.config.get<string>("greetingName") ?? "World";
    ctx.logger.info(`hello-world enabled — greeting ${name}`);
  },

  health(): HealthResult {
    return { status: "ok", detail: "hello-world is happy" };
  },
});
