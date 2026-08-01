import { Global, Module, type Provider } from "@nestjs/common";
import { LoggerModule as PinoNestLoggerModule } from "nestjs-pino";
import pino from "pino";
import { PLATFORM_LOGGER } from "./logging.constants.js";
import { PluginLoggerFactory } from "./plugin-logger.factory.js";

/**
 * One pino instance for the whole process: structured JSON out, shared by
 * (a) Nest's own HTTP request logging (via nestjs-pino, wired below with
 * the SAME instance so request logs and app logs interleave correctly) and
 * (b) every plugin's scoped logger (via `PluginLoggerFactory`).
 *
 * We deliberately do NOT rely on `nestjs-pino`'s `PinoLogger.root` static —
 * it's only assigned once Nest applies the HTTP middleware (inside
 * `LoggerModule#configure`), which can run later than other providers'
 * `onModuleInit`. Owning the pino instance ourselves means it's available
 * immediately, with no init-order dependency on nestjs-pino internals.
 */
const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  base: { service: "constellation-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

const rootLoggerProvider: Provider = {
  provide: PLATFORM_LOGGER,
  useValue: rootLogger,
};

@Global()
@Module({
  imports: [
    // Gives us Nest-integrated HTTP request logging (pino-http under the
    // hood) and lets any core module inject nestjs-pino's `Logger` if it
    // wants Nest's familiar `LoggerService` surface — both backed by the
    // exact same `rootLogger` instance declared above.
    PinoNestLoggerModule.forRoot({
      pinoHttp: { logger: rootLogger },
    }),
  ],
  providers: [rootLoggerProvider, PluginLoggerFactory],
  exports: [rootLoggerProvider, PluginLoggerFactory],
})
export class LoggingModule {}
