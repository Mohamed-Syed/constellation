import { Injectable, Logger, Optional } from "@nestjs/common";
import { EventBusService } from "../events/event-bus.service.js";
import { ScheduledTaskService } from "../engine/scheduled-task.service.js";
import { WorkflowRunService } from "./workflow-run.service.js";

/** Minimal workflow shape the trigger service needs (definition.trigger). */
export interface WorkflowTriggerInput {
  id: string;
  name: string;
  definition: { trigger?: { type?: string; cron?: string; event?: string } };
}

/**
 * Phase 3.0 — workflow trigger wiring (the round that hooks the stored
 * cron/event triggers to the platform):
 *
 *   trigger.type = "cron"  → an auto-managed ScheduledTask named
 *                            `workflow:<id>` (kind cron, `workflowId` set).
 *                            When the scheduler fires it, WorkflowRunService
 *                            runs the WORKFLOW instead of enqueuing a task.
 *   trigger.type = "event" → an EventBus listener armed on the named event,
 *                            on BOTH scopes — `core:<event>` (engine events
 *                            such as engine.task.failed — the autonomous
 *                            incident-response pattern: a failed task fires a
 *                            remediation workflow) and `platform:<event>`
 *                            (plugin lifecycle events).
 *   trigger.type = "manual" (or none) → no schedule, no listener.
 *
 * Reconcile-on-change: `sync()` is called on workflow create/update,
 * `remove()` on delete — the ScheduledTask is removed + recreated so it
 * always reflects the current cron expression (schedule ids may rotate; the
 * name is stable). Event listeners can't be unregistered on the in-process
 * bus, so deactivation uses an active-set guard (same pattern as the
 * scheduler's event schedules).
 *
 * Runs are fire-and-forget (a workflow run can take minutes; the scheduler
 * poll loop must not block). Overlapping runs are possible if a run outlives
 * the trigger cadence — documented, accepted for v1.
 */
@Injectable()
export class WorkflowTriggerService {
  private readonly logger = new Logger(WorkflowTriggerService.name);
  /** `${workflowId}::${event}` keys whose listener is currently armed. */
  private readonly activeEvents = new Set<string>();

  constructor(
    private readonly schedules: ScheduledTaskService,
    private readonly runs: WorkflowRunService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /** Reconcile the schedule + listener for one workflow's trigger. Never throws. */
  async sync(workflow: WorkflowTriggerInput): Promise<void> {
    try {
      await this.syncInner(workflow);
    } catch (err) {
      this.logger.warn(`Workflow trigger sync failed for ${workflow.id}: ${asMessage(err)}`);
    }
  }

  private async syncInner(workflow: WorkflowTriggerInput): Promise<void> {
    const trigger = workflow.definition?.trigger;
    const scheduleName = `workflow:${workflow.id}`;
    const existing = (await this.schedules.findAll()).find((s) => s.name === scheduleName);

    if (trigger?.type === "cron" && trigger.cron) {
      if (existing) await this.schedules.remove(existing.id);
      await this.schedules.create({
        name: scheduleName,
        kind: "cron",
        cron: trigger.cron,
        workflowId: workflow.id,
        enabled: true,
        task: { title: `Workflow: ${workflow.name}`, prompt: "", maxSteps: 1 },
      });
      this.logger.log(`Workflow ${workflow.id} cron trigger armed: "${trigger.cron}"`);
    } else if (existing) {
      await this.schedules.remove(existing.id);
    }

    if (trigger?.type === "event" && trigger.event) {
      this.registerEvent(workflow.id, trigger.event);
    } else {
      // Deactivate ANY event listener for this workflow (the trigger may
      // have changed event names — clear the whole prefix).
      for (const key of [...this.activeEvents]) {
        if (key.startsWith(`${workflow.id}::`)) this.activeEvents.delete(key);
      }
    }
  }

  /** Drop the schedule + deactivate any event listener for the workflow. Never throws. */
  async remove(workflowId: string): Promise<void> {
    try {
      const existing = (await this.schedules.findAll()).find((s) => s.name === `workflow:${workflowId}`);
      if (existing) await this.schedules.remove(existing.id);
    } catch (err) {
      this.logger.warn(`Workflow trigger cleanup failed for ${workflowId}: ${asMessage(err)}`);
    }
    for (const key of [...this.activeEvents]) {
      if (key.startsWith(`${workflowId}::`)) this.activeEvents.delete(key);
    }
  }

  private registerEvent(workflowId: string, event: string): void {
    const key = `${workflowId}::${event}`;
    if (this.activeEvents.has(key) || !this.eventBus) return;
    this.activeEvents.add(key);
    const handler = (): void => {
      if (!this.activeEvents.has(key)) return;
      void this.runs.run(workflowId).catch((err: unknown) =>
        this.logger.error(`Event-triggered workflow ${workflowId} (on "${event}") failed: ${asMessage(err)}`),
      );
    };
    // Both scopes: core:<event> (engine events — incident response) and
    // platform:<event> (plugin lifecycle events).
    try {
      this.eventBus.forPlugin("core").on(event, handler);
    } catch (err) {
      this.logger.warn(`Could not arm core listener for "${event}": ${asMessage(err)}`);
    }
    try {
      this.eventBus.onPlatform(event, handler);
    } catch (err) {
      this.logger.warn(`Could not arm platform listener for "${event}": ${asMessage(err)}`);
    }
    this.logger.log(`Workflow ${workflowId} event trigger armed on "${event}" (core + platform scopes)`);
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
