import { BadRequestException, Body, Controller, Get, Optional, Post, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";
import { CorePermissions } from "@constellation/plugin-sdk";
import { RequirePermissions } from "../rbac/require-permissions.decorator.js";
import { PermissionsGuard } from "../rbac/permissions.guard.js";
import { MeshService } from "../mesh/mesh.service.js";
import { TaskService } from "../engine/task.service.js";
import { TaskQueueService } from "../engine/task-queue.service.js";
import { SchedulerEngineService } from "../engine/scheduler-engine.service.js";
import { SupervisorService } from "../engine/supervisor.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { PluginRegistryService } from "../plugins/plugin-registry.service.js";
import { ControllerService, type ControllerSnapshot } from "./controller.service.js";
import { ControllerWatchService, type ControllerWatchStatus } from "./controller-watch.service.js";

/** Body of POST /api/ai-controller/act. Validated by the global ValidationPipe. */
class ActDto {
  @IsString()
  @IsNotEmpty()
  action!: string;
}

/**
 * Phase 5.0 — AGENTIC AI CONTROLLER.
 *
 *   GET  /api/ai-controller/status — the platform's live stability snapshot:
 *        score (0–100), findings per subsystem (naming the actual down mesh
 *        peers), recommended actions.
 *   GET  /api/ai-controller/actions — the whitelist of safe actions.
 *   POST /api/ai-controller/act    — run a whitelisted safe recovery action.
 *
 * The controller gathers LIVE state (engine availability, queue, scheduler,
 * supervisor, mesh, plugins, dead letters) and folds it into the deterministic
 * score + findings. Reads are admin-gated (core:audit:read — platform:admin
 * implies it); running a recovery action additionally requires
 * core:ai-controller:manage, so a read-only auditor can never mutate.
 */
@ApiTags("ai-controller")
@Controller("ai-controller")
@UseGuards(PermissionsGuard)
export class AiController {
  constructor(
    private readonly controller: ControllerService,
    private readonly mesh: MeshService,
    private readonly tasks: TaskService,
    private readonly queue: TaskQueueService,
    private readonly scheduler: SchedulerEngineService,
    private readonly supervisor: SupervisorService,
    private readonly notifications: NotificationService,
    private readonly plugins: PluginRegistryService,
    @Optional() private readonly watch?: ControllerWatchService,
  ) {}

  @Get("status")
  @RequirePermissions(CorePermissions.AUDIT_READ)
  @ApiOkResponse({ description: "Live platform stability snapshot (score + findings + recommended actions + watch state)." })
  async status(): Promise<ControllerSnapshot & { watch?: ControllerWatchStatus }> {
    const [mesh, sched, sup, queue, deadLetters, pluginSummary] = await Promise.all([
      this.mesh.topology().catch(() => null),
      this.scheduler.getHealth().catch(() => null),
      this.supervisor.getHealth().catch(() => null),
      this.queue.getHealth().catch(() => null),
      this.tasks.getFailedCount().catch(() => 0),
      Promise.resolve(this.plugins.summary()),
    ]);
    const signals = {
      engineAvailable: true, // the api itself is up (it's serving this request)
      queueOk: queue?.enabled ?? undefined,
      schedulerOk: sched?.enabled ?? undefined,
      supervisorOk: sup?.enabled ?? undefined,
      mesh,
      deadLetterTasks: deadLetters,
      pluginsDegraded: pluginSummary.degradedOrDown + pluginSummary.failed,
    };
    return { ...(await this.controller.monitor(signals)), watch: this.watch?.status() };
  }

  @Post("act")
  @RequirePermissions(CorePermissions.AI_CONTROLLER_MANAGE)
  @ApiOkResponse({ description: "Run a whitelisted safe controller action." })
  async act(@Body() body: ActDto) {
    const action = body.action.trim();
    const result = await this.controller.act(action);
    if (!result.ok) throw new BadRequestException(result.message);
    if (result.ran) {
      await this.notifications.record("ai-controller.acted", "info", "AI Controller acted", result.message, "ai-controller", action);
    }
    return result;
  }

  @Get("actions")
  @RequirePermissions(CorePermissions.AUDIT_READ)
  @ApiOkResponse({ description: "The whitelist of safe actions the controller can run." })
  actions() {
    return { actions: this.controller.availableActions() };
  }
}
