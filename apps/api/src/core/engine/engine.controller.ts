import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { Public } from "../auth/public.decorator.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthPrincipal } from "../auth/token-verifier.js";
import { CreateTaskDto } from "./dto/create-task.dto.js";
import { ModelRouterService } from "./model-router.service.js";
import { TaskQueueService } from "./task-queue.service.js";
import { TaskService } from "./task.service.js";

/**
 * Engine REST API.
 *
 * POST /api/engine/tasks       — submit a task to the agent queue
 * GET  /api/engine/tasks       — list tasks (newest first, max 100)
 * GET  /api/engine/tasks/:id   — task detail + full step history
 * POST /api/engine/tasks/:id/cancel — cancel a queued or running task
 * GET  /api/engine/health      — queue + model router health (@Public)
 *
 * All mutation routes require a valid bearer token (the global JwtAuthGuard
 * applies). Granular engine permissions (core:engine:task:submit etc.) are
 * defined in the SDK's CorePermissions and can be layered on later; today
 * any authenticated user can submit tasks.
 */
@Controller("engine")
export class EngineController {
  private readonly logger = new Logger(EngineController.name);

  constructor(
    private readonly tasks: TaskService,
    private readonly queue: TaskQueueService,
    private readonly modelRouter: ModelRouterService,
  ) {}

  @Post("tasks")
  async submitTask(
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    const task = await this.tasks.create(dto, user?.id);
    await this.queue.enqueue(task.id);
    this.logger.log(`Task ${task.id} queued by ${user?.id ?? "unknown"}: "${dto.title}"`);
    return { id: task.id, status: task.status, title: task.title, createdAt: task.createdAt };
  }

  @Get("tasks")
  async listTasks() {
    return this.tasks.findAll();
  }

  @Get("tasks/:id")
  async getTask(@Param("id") id: string) {
    const task = await this.tasks.findOne(id);
    if (!task) throw new NotFoundException(`Task "${id}" not found`);
    return task;
  }

  @Post("tasks/:id/cancel")
  async cancelTask(@Param("id") id: string) {
    const cancelled = await this.tasks.cancel(id);
    if (!cancelled) {
      throw new BadRequestException(`Task "${id}" cannot be cancelled (not found or already terminal)`);
    }
    return { id, status: "cancelled" };
  }

  @Public()
  @Get("health")
  async health() {
    const [queue, model] = await Promise.all([
      this.queue.getHealth(),
      this.modelRouter.health(),
    ]);
    return { queue, model, timestamp: new Date().toISOString() };
  }
}
