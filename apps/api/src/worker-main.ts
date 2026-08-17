import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module.js";

/**
 * DEDICATED WORKER ENTRYPOINT (Phase 2.0 2.8 — worker as a separate process).
 *
 * Boots the full Nest application context WITHOUT the HTTP server: the
 * engine's loop services (AgentWorkerService, SchedulerEngineService,
 * SupervisorService) start via their onModuleInit hooks and consume the
 * BullMQ queue in Redis — the same queue the api process enqueues into. The
 * api and worker share DATABASE_URL + REDIS_URL + the model keys; each
 * process is independently scalable.
 *
 * Invocation: ENGINE_WORKER_MODE=separate ENGINE_IS_WORKER=true \
 *   node dist/worker-main.js   (see scripts/boot-worker.sh)
 *
 * The keep-alive interval is REF'D on purpose: the loop timers are unref'd
 * (so they don't hold the api hostage), and without one ref'd handle this
 * process would exit immediately after boot.
 */
async function bootstrap(): Promise<void> {
  process.env.ENGINE_IS_WORKER = "true";
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
  Logger.log("Constellation WORKER started (separate process, no HTTP server)", "Bootstrap");
  setInterval(() => {
    /* keep the worker process alive */
  }, 60_000);
  void app;
}

void bootstrap();
