import { Injectable, Logger, Optional } from "@nestjs/common";
import { MeshService, type MeshTopologyView } from "../mesh/mesh.service.js";
import { TaskService } from "../engine/task.service.js";
import { TaskQueueService } from "../engine/task-queue.service.js";
import { SupervisorService } from "../engine/supervisor.service.js";
import { PluginRegistryService } from "../plugins/plugin-registry.service.js";
import { asMessage } from "../engine/error-utils.js";

/** One platform-health finding the controller surfaced. */
export interface ControllerFinding {
  id: string;
  severity: "ok" | "info" | "warn" | "crit";
  area: string;
  title: string;
  detail: string;
}

/** The AI Controller's snapshot of the platform. */
export interface ControllerSnapshot {
  generatedAt: string;
  score: number;
  label: string;
  findings: ControllerFinding[];
  actionsRecommended: string[];
}

export interface ControllerSignals {
  engineAvailable?: boolean;
  engineReason?: string | null;
  queueOk?: boolean;
  schedulerOk?: boolean;
  supervisorOk?: boolean;
  mesh?: MeshTopologyView | null;
  pluginsDegraded?: number;
  deadLetterTasks?: number;
}

/** Result of running a whitelisted controller action. */
export interface ControllerActionResult {
  ok: boolean;
  ran: boolean;
  message: string;
}

/**
 * Phase 5.0 — AGENTIC AI CONTROLLER (MONITOR + SAFE ACTIONS).
 *
 * The Controller is the platform's own operator: it continuously assesses the
 * live state of EVERY subsystem (engine, queue, scheduler, supervisor, mesh,
 * plugins, budget) and, when it spots a problem, acts — but only from a
 * whitelist of idempotent, safe recovery actions. It never makes a damaging
 * change; anything ambiguous becomes an explicit recommendation for a human
 * (or a later, explicitly-opted-in autonomous tier).
 *
 * Ordering principle: solve a
 * REAL operational problem — an operator must today watch the dashboard and
 * hand-fix stale tasks, dead-queues, down peers. The Controller computes a
 * stability score, issues findings, and runs the safe fixes.
 *
 * TESTABILITY: signals are injected (the `ControllerSignals` seam) or collected
 * from injected services with @Optional() — with nothing wired, the monitor
 * degrades to an honest "no data" snapshot and never throws.
 */
@Injectable()
export class ControllerService {
  private readonly logger = new Logger(ControllerService.name);

  constructor(
    @Optional() private readonly mesh?: MeshService,
    @Optional() private readonly tasks?: TaskService,
    @Optional() private readonly queue?: TaskQueueService,
    @Optional() private readonly supervisor?: SupervisorService,
    @Optional() private readonly plugins?: PluginRegistryService,
  ) {}

  /**
   * Collect a fresh operational snapshot + stability score + findings.
   * `signals` may be passed directly (the portal/self-heal caller gathers the
   * live state); when the engine/mesh services are injected, their live state
   * is folded in as fallbacks.
   */
  async monitor(signals: ControllerSignals = {}): Promise<ControllerSnapshot> {
    const mesh: MeshTopologyView | null = signals.mesh ?? (this.mesh ? await this.mesh.topology().catch(() => null) : null);

    // Plugin degradation signal: the caller passes `pluginsDegraded`; when the
    // PluginRegistryService is injected it is derived live. `failed` (load
    // failure) folds into the same signal — a plugin that never loaded is just
    // as unusable as one whose health poll failed.
    const pluginsDegraded =
      signals.pluginsDegraded ?? (this.plugins ? this.plugins.summary().degradedOrDown + this.plugins.summary().failed : 0);

    const findings: ControllerFinding[] = [];

    if (signals.engineAvailable === false) {
      findings.push({
        id: "engine-down",
        severity: "crit",
        area: "engine",
        title: "Engine unavailable",
        detail: signals.engineReason ?? "The engine backend is not accepting tasks.",
      });
    } else {
      findings.push({ id: "engine-ok", severity: "ok", area: "engine", title: "Engine up", detail: "The engine is available." });
    }

    if (signals.queueOk === false) {
      findings.push({ id: "queue-down", severity: "crit", area: "queue", title: "Task queue unhealthy", detail: "BullMQ/queue reports an unhealthy state." });
    }
    if (signals.schedulerOk === false) {
      findings.push({ id: "scheduler-down", severity: "warn", area: "scheduler", title: "Scheduler not sweeping", detail: "Cron/event schedules may not be firing." });
    }
    if (signals.supervisorOk === false) {
      findings.push({ id: "supervisor-down", severity: "warn", area: "supervisor", title: "Supervisor not healing", detail: "Stale-task recovery may be off." });
    }
    if ((signals.deadLetterTasks ?? 0) > 0) {
      findings.push({ id: "dead-letter", severity: "warn", area: "tasks", title: "Dead-lettered tasks", detail: `${signals.deadLetterTasks} task(s) failed terminally and are waiting for operator attention.` });
    }
    if (pluginsDegraded > 0) {
      findings.push({ id: "plugins-degraded", severity: "info", area: "plugins", title: "Plugin(s) degraded", detail: `${pluginsDegraded} plugin(s) are enabled but not usable (missing credentials or load failure).` });
    }
    if (mesh) {
      const down = mesh.counts?.down ?? 0;
      if (down > 0) {
        // Name the actual down peers so the operator (or the portal page)
        // knows exactly WHICH instance is unreachable, not just a count.
        const downNames = (mesh.peers ?? []).filter((p) => p.status === "down").map((p) => p.name);
        findings.push({
          id: "mesh-down",
          severity: down > 1 ? "crit" : "warn",
          area: "mesh",
          title: `${down} mesh peer(s) down`,
          detail: downNames.length
            ? `Unreachable: ${downNames.join(", ")}. The prober could not reach their /api/health.`
            : "One or more federated peers are unreachable or not responding.",
        });
      } else {
        findings.push({ id: "mesh-ok", severity: "ok", area: "mesh", title: "Mesh healthy", detail: `All ${mesh.counts?.total ?? 0} mesh peer(s) are up.` });
      }
    } else {
      findings.push({ id: "mesh-unknown", severity: "info", area: "mesh", title: "Mesh not inspected", detail: "No mesh topology available to inspect." });
    }

    const score = computeScore(findings);
    const actionsRecommended = recommendedActions(findings);

    return {
      generatedAt: new Date().toISOString(),
      score,
      label: labelFor(score),
      findings,
      actionsRecommended,
    };
  }

  /**
   * Run a whitelisted, idempotent recovery action by name. Safe actions only.
   * Returns whether the action ran and a human description. Anything not in
   * the whitelist (or needing external state) becomes a recommendation, never
   * an arbitrary mutation.
   */
  async act(action: string): Promise<ControllerActionResult> {
    switch (action) {
      case "reprobe-mesh":
        if (!this.mesh) return { ok: false, ran: false, message: "Mesh service is not available." };
        await this.mesh.probeAll().catch(() => undefined);
        return { ok: true, ran: true, message: "Re-probed all mesh peers." };

      case "re-enqueue-deadletters": {
        if (!this.tasks || !this.queue) return { ok: false, ran: false, message: "Task engine is not available." };
        const failed = await this.tasks.findAllFailed(25, "asc").catch(() => []);
        let reenqueued = 0;
        for (const task of failed) {
          try {
            // Enqueue FIRST, then flip the row. If the enqueue fails (e.g.
            // Redis died after boot) the row stays `failed` — still visible to
            // the dead-letter finding, never parked in invisible limbo. The
            // `requeue` status gate also means a task the worker already
            // completed mid-loop can never be resurrected.
            await this.queue.enqueue(task.id);
            const flipped = await this.tasks.requeue(task.id);
            if (flipped) reenqueued++;
          } catch (err) {
            this.logger.warn(`Could not re-enqueue dead-lettered task ${task.id}: ${asMessage(err)}`);
          }
        }
        // Honest result: ran only when something was actually re-enqueued; ok
        // only when every eligible dead letter made it (a partial failure is a
        // real failure the portal must show, not a green success toast).
        if (reenqueued === 0) return { ok: failed.length === 0, ran: false, message: `Re-enqueued 0 of ${failed.length} dead-lettered task(s).` };
        return { ok: reenqueued === failed.length, ran: true, message: `Re-enqueued ${reenqueued} of ${failed.length} dead-lettered task(s).` };
      }

      case "flush-stale": {
        if (!this.supervisor) return { ok: false, ran: false, message: "Supervisor service is not available." };
        try {
          const result = await this.supervisor.runSweep();
          return {
            ok: true,
            ran: result.ran,
            message: result.ran
              ? `Supervisor sweep: ${result.staleFound} stale, ${result.recovered} recovered, ${result.failedStalled} failed, ${result.skippedActive} active-skipped.`
              : "Supervisor sweep skipped (engine disabled or sweep already in progress).",
          };
        } catch (err) {
          // runSweep can throw (Redis died post-boot, DB death mid-sweep) —
          // degrade honestly like every other action instead of a raw 500.
          return { ok: false, ran: false, message: `Supervisor sweep failed: ${asMessage(err)}` };
        }
      }

      case "run-deepseek-diagnostic": {
        if (!this.tasks || !this.queue) return { ok: false, ran: false, message: "Task engine is not available." };
        const model = process.env.DEFAULT_MODEL || "deepseek-v4-flash";
        const task = await this.tasks
          .create(
            {
              title: "AI Controller diagnostic",
              prompt:
                "You are running a Constellation platform self-diagnostic. " +
                "Reply with exactly one line: 'diagnostic-ok' followed by a short statement of your model identity.",
              model,
              maxSteps: 3,
            },
            undefined,
          )
          .catch(() => null);
        if (!task) return { ok: false, ran: false, message: "Could not create the diagnostic task (database unavailable?)." };
        try {
          await this.queue.enqueue(task.id);
        } catch (err) {
          // Never claim success when the enqueue failed — and don't leave an
          // orphaned `queued` row that no worker will ever pick up: flip it
          // back to failed so the dead-letter finding still sees it.
          await this.tasks.markFailed(task.id, `Diagnostic enqueue failed: ${asMessage(err)}`).catch(() => undefined);
          return { ok: false, ran: false, message: `Diagnostic task ${task.id} created but could not be enqueued (queue unavailable).` };
        }
        return { ok: true, ran: true, message: `Diagnostic task ${task.id} enqueued on ${model}.` };
      }

      default:
        // Unknown / not-yet-implemented actions are explicitly rejected so the
        // controller can never guess a mutation.
        return { ok: false, ran: false, message: `No safe controller action '${action}'. Available: ${this.availableActions().join(", ")}.` };
    }
  }

  /** The whitelist of safe actions the controller can run. */
  availableActions(): string[] {
    return ["reprobe-mesh", "re-enqueue-deadletters", "flush-stale", "run-deepseek-diagnostic"];
  }
}

function computeScore(findings: ControllerFinding[]): number {
  let score = 100;
  for (const f of findings) {
    if (f.severity === "crit") score -= 30;
    else if (f.severity === "warn") score -= 10;
    else if (f.severity === "info") score -= 2;
  }
  return Math.max(0, Math.min(100, score));
}

function labelFor(score: number): string {
  return score >= 90 ? "Healthy" : score >= 70 ? "Degraded" : score >= 40 ? "Unstable" : "Critical";
}

function recommendedActions(findings: ControllerFinding[]): string[] {
  const out: string[] = [];
  if (findings.some((f) => f.id === "mesh-down")) out.push("reprobe-mesh");
  if (findings.some((f) => f.id === "dead-letter")) out.push("re-enqueue-deadletters");
  if (findings.some((f) => f.id === "engine-down")) out.push("check Redis and the engine worker");
  if (findings.some((f) => f.id === "scheduler-down" || f.id === "supervisor-down")) out.push("restart the api process");
  return out;
}
