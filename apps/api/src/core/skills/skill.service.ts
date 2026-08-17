import { Injectable, Logger } from "@nestjs/common";
import { ScheduledTaskService, type ScheduledTaskRecord } from "../engine/scheduled-task.service.js";

/**
 * Skill marketplace round (Phase 4.0 4.4) — pre-built AGENT SKILLS.
 *
 * A skill is a packaged (cron schedule + prompt template + model/steps
 * defaults): "install" creates a `skill:<id>` scheduled task that runs the
 * skill's prompt on the given cadence; "uninstall" removes it. The catalog is
 * deterministic and versioned here so the portal can render cards and the
 * platform can extend it without new infra — this IS the "app store" primitive:
 * a non-developer picks a skill, it runs.
 *
 * State lives in the SCHEDULER (ScheduledTask.name = `skill:<id>`), so a skill
 * installation is a real, inspectable schedule that the existing scheduler
 * engine executes (cron → task), survives restarts, and shows in /engine
 * schedules + the workflow trigger tooling. No new tables.
 */
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  cron: string;
  prompt: string;
  model?: string;
  maxSteps: number;
}

export const SKILL_CATALOG: SkillDefinition[] = [
  {
    id: "daily-pr-triage",
    name: "Daily GitHub PR triage",
    description: "Every morning, summarize open PRs, flag stale ones and surface merge conflicts.",
    category: "GitHub",
    cron: "0 8 * * *",
    maxSteps: 8,
    prompt:
      "You are Constellation's daily PR triage agent. List the open pull requests in the connected repositories, " +
      "flag any PR that has been open more than 7 days, note conflicts or failing checks you can detect, and produce " +
      "a short triage summary with recommended actions. If you have no repository access, say so and list what you would check.",
  },
  {
    id: "weekly-dependency-audit",
    name: "Weekly dependency audit",
    description: "Scan the workspace's dependency manifests for outdated or vulnerable packages.",
    category: "Security",
    cron: "0 9 * * 1",
    maxSteps: 10,
    prompt:
      "You are the weekly dependency audit agent. Inspect package manifests (package.json, pnpm-lock.yaml, requirements files) " +
      "in the workspace. Identify outdated major-version dependencies and anything you can flag as a security risk. " +
      "Report a prioritized list: package, current version, suggested major target, and why it matters.",
  },
  {
    id: "ssl-cert-expiry-monitor",
    name: "SSL certificate expiry monitor",
    description: "Check configured endpoints for expiring TLS certificates.",
    category: "Infrastructure",
    cron: "0 7 * * *",
    maxSteps: 6,
    prompt:
      "You are the certificate expiry monitor. For the endpoints you know about, check TLS certificate expiry dates. " +
      "Report any certificate expiring within 30 days with its exact expiry date and the hostname. If you cannot reach " +
      "an endpoint, report that too. End with an OK line when everything is healthy.",
  },
  {
    id: "nightly-health-check",
    name: "Nightly platform health check",
    description: "Runs the platform health checklist: engine, scheduler, queue, model router.",
    category: "Operations",
    cron: "0 3 * * *",
    maxSteps: 8,
    prompt:
      "You are the nightly health-check agent. Query the platform health endpoints (engine availability, model router, " +
      "queue, scheduler). Report each component as OK or DEGRADED with the reason, then a one-line overall verdict. " +
      "If anything is degraded, list the first thing to investigate.",
  },
  {
    id: "weekly-cost-report",
    name: "Weekly model-cost report",
    description: "Summarizes task token usage and estimated spend for the last 7 days.",
    category: "Finance",
    cron: "0 10 * * 1",
    maxSteps: 8,
    prompt:
      "You are the cost reporting agent. Look at recent completed tasks and their persisted usage (tokens, estimated cost). " +
      "Summarize the last 7 days: total tasks, total tokens, estimated spend, the most expensive tasks, and the most-used " +
      "models. Present a compact weekly cost report.",
  },
  {
    id: "daily-incident-summary",
    name: "Daily incident summary",
    description: "A morning brief of yesterday's failed tasks and dead letters.",
    category: "Operations",
    cron: "0 6 * * *",
    maxSteps: 8,
    prompt:
      "You are the incident summary agent. Review the last 24 hours of task failures and dead letters. Group them by " +
      "cause, name the top failure mode, and suggest one concrete prevention for each group. Keep the brief under 15 lines.",
  },
  {
    id: "weekly-code-review-digest",
    name: "Weekly code review digest",
    description: "Digest of review feedback themes and follow-ups for the week.",
    category: "GitHub",
    cron: "0 11 * * 5",
    maxSteps: 8,
    prompt:
      "You are the code review digest agent. Collect the review themes of the week (what reviewers asked for most), " +
      "which files drew the most attention, and any recurring follow-up items. Produce a short digest with an action list.",
  },
];

export interface SkillWithState extends SkillDefinition {
  installed: boolean;
  enabled: boolean;
  scheduleId: string | null;
  nextRunAt: string | null;
}

const SKILL_PREFIX = "skill:";

/**
 * Install/uninstall/list skills backed by the scheduler. Degrades honestly:
 * without a DB the catalog still lists (installed: false everywhere).
 */
@Injectable()
export class SkillService {
  private readonly logger = new Logger(SkillService.name);

  constructor(private readonly schedules: ScheduledTaskService) {}

  async list(): Promise<SkillWithState[]> {
    const rows = await this.schedules.findAll();
    const byName = new Map<string, ScheduledTaskRecord>();
    for (const row of rows) {
      if (row.name.startsWith(SKILL_PREFIX)) byName.set(row.name.slice(SKILL_PREFIX.length), row);
    }
    return SKILL_CATALOG.map((skill) => {
      const installed = byName.get(skill.id);
      return {
        ...skill,
        installed: installed !== undefined,
        enabled: installed?.enabled ?? false,
        scheduleId: installed?.id ?? null,
        nextRunAt: installed?.nextRunAt ? installed.nextRunAt.toISOString() : null,
      };
    });
  }

  async install(id: string): Promise<SkillWithState | null> {
    const skill = SKILL_CATALOG.find((s) => s.id === id);
    if (!skill) return null;
    const existing = (await this.list()).find((s) => s.id === id);
    if (existing?.installed) return existing;
    await this.schedules.create({
      name: `${SKILL_PREFIX}${skill.id}`,
      kind: "cron",
      cron: skill.cron,
      task: {
        title: skill.name,
        prompt: skill.prompt,
        model: skill.model ?? undefined,
        maxSteps: skill.maxSteps,
      },
      enabled: true,
    });
    this.logger.log(`Skill installed: ${skill.id} (cron ${skill.cron})`);
    return (await this.list()).find((s) => s.id === id) ?? null;
  }

  async uninstall(id: string): Promise<boolean> {
    const installed = (await this.list()).find((s) => s.id === id);
    if (!installed?.scheduleId) return false;
    return this.schedules.remove(installed.scheduleId);
  }

  /** Flip enabled/disabled on an installed skill's schedule. */
  async toggle(id: string): Promise<SkillWithState | null> {
    const installed = (await this.list()).find((s) => s.id === id);
    if (!installed?.scheduleId) return null;
    if (installed.enabled) await this.schedules.disable(installed.scheduleId);
    else await this.schedules.enable(installed.scheduleId);
    return (await this.list()).find((s) => s.id === id) ?? null;
  }
}
