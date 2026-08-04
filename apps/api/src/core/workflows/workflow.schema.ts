/**
 * Phase 3.0 — visual workflow builder: the WorkflowDefinition shape + a
 * dependency-free validator (the repo's DTO layer is class-validator; the
 * definition is dynamic JSON so it gets a purpose-built validator here).
 *
 * Shape:
 *   {
 *     trigger: { type: "manual" | "cron" | "event", cron?: string, event?: string },
 *     steps: [
 *       { id, kind: "agent", label?, prompt, model?, maxSteps? } |   // runs an engine task
 *       { id, kind: "tool",  label?, plugin, tool, args? }           // invokes a plugin tool
 *     ]
 *   }
 *
 * Steps run top-to-bottom. A step may reference an EARLIER step's outcome via
 * template placeholders: {{steps.<id>.result}} and {{steps.<id>.error}}
 * (replaced with the rendered text; JSON objects are stringified).
 */

export type WorkflowStep =
  | {
      id: string;
      kind: "agent";
      label?: string;
      prompt: string;
      model?: string;
      maxSteps?: number;
    }
  | {
      id: string;
      kind: "tool";
      label?: string;
      plugin: string;
      tool: string;
      args?: Record<string, unknown>;
    };

export interface WorkflowTrigger {
  type: "manual" | "cron" | "event";
  cron?: string;
  event?: string;
}

export interface WorkflowDefinition {
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
}

/** Non-empty, URL-safe-ish id for a step (no spaces, no path separators). */
export function isValidStepId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** Validate a parsed definition; returns a human-readable error or null. */
export function validateWorkflowDefinition(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return "definition must be an object";
  const def = raw as Record<string, unknown>;

  const trigger = def.trigger as Record<string, unknown> | undefined;
  if (!trigger || typeof trigger !== "object") return "definition.trigger is required";
  if (!["manual", "cron", "event"].includes(String(trigger.type))) {
    return "definition.trigger.type must be manual, cron or event";
  }
  if (trigger.type === "cron" && typeof trigger.cron !== "string") {
    return "definition.trigger.cron is required for cron triggers";
  }
  if (trigger.type === "event" && typeof trigger.event !== "string") {
    return "definition.trigger.event is required for event triggers";
  }

  const steps = def.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    return "definition.steps must be a non-empty array";
  }
  if (steps.length > 20) return "definition.steps supports at most 20 steps";

  const seen = new Set<string>();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Record<string, unknown> | undefined;
    if (!step || typeof step !== "object") return `step ${i}: must be an object`;
    if (!isValidStepId(step.id)) return `step ${i}: id must be 1-64 chars of A-Za-z0-9_-`;
    if (seen.has(String(step.id))) return `step ${i}: duplicate id "${String(step.id)}"`;
    seen.add(String(step.id));

    if (step.kind === "agent") {
      if (typeof step.prompt !== "string" || step.prompt.trim().length === 0) {
        return `step ${i} ("${String(step.id)}"): agent steps need a non-empty prompt`;
      }
      if (step.model !== undefined && typeof step.model !== "string") {
        return `step ${i} ("${String(step.id)}"): model must be a string`;
      }
      if (step.maxSteps !== undefined && (!Number.isInteger(step.maxSteps) || Number(step.maxSteps) < 1 || Number(step.maxSteps) > 50)) {
        return `step ${i} ("${String(step.id)}"): maxSteps must be an integer 1-50`;
      }
    } else if (step.kind === "tool") {
      if (typeof step.plugin !== "string" || step.plugin.trim().length === 0) {
        return `step ${i} ("${String(step.id)}"): tool steps need a plugin id`;
      }
      if (typeof step.tool !== "string" || step.tool.trim().length === 0) {
        return `step ${i} ("${String(step.id)}"): tool steps need a tool name`;
      }
      if (step.args !== undefined && (typeof step.args !== "object" || step.args === null || Array.isArray(step.args))) {
        return `step ${i} ("${String(step.id)}"): args must be an object`;
      }
    } else {
      return `step ${i}: kind must be "agent" or "tool"`;
    }
  }

  return null;
}

/**
 * Render {{steps.<id>.result}} / {{steps.<id>.error}} placeholders in `text`
 * using the outcomes collected so far. Unknown references are left as-is so
 * the author sees the mistake in the result rather than a silent blank.
 */
export function renderTemplates(text: string, outcomes: Map<string, { ok: boolean; result: unknown; error?: string }>): string {
  return text.replace(/\{\{steps\.([A-Za-z0-9_-]+)\.(result|error)\}\}/g, (match, id: string, field: string) => {
    const outcome = outcomes.get(id);
    if (!outcome) return match;
    const value = field === "error" ? (outcome.error ?? "") : outcome.result;
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return match;
    }
  });
}
