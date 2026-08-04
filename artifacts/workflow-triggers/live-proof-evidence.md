# Live-proof evidence — Phase 3.0 · WORKFLOW TRIGGER WIRING (2026-08-04)

Round C of the "finish the roadmap" pass — Polaris. Files: `workflow-cron.json`,
`workflow-cron-updated.json`, `workflow-event.json`, `schedules-after-cron.json`,
`doomed-task.json`, `workflow-cron-final*.json`, `workflow-event-final.json`.

## What shipped
- **`ScheduledTask.workflowId`** (migration `20260804202859_add_workflow_triggers`):
  a schedule with `workflowId` RUNS the workflow (WorkflowRunService) instead of
  enqueuing an engine task — the scheduler branches in `fireSchedule`
  (fire-and-forget: a workflow run can take minutes, the poll loop must not
  block; overlapping runs are documented-accepted).
- **`WorkflowTriggerService`** (workflows core): reconcile-on-change —
  `trigger.type="cron"` → auto-managed ScheduledTask `workflow:<id>` (remove +
  recreate so the cron expression always matches; PUT re-sync proven);
  `trigger.type="event"` → EventBus listener armed on BOTH scopes
  (`core:<event>` for engine events, `platform:<event>` for plugin events),
  deactivated via an active-set guard (in-process bus has no unregister).
  `sync()` on create/update, `remove()` on delete; never throws.
- **Scheduler ↔ WorkflowsModule cycle** wired with the standard bidirectional
  `forwardRef` pattern.
- This IS the **autonomous incident-response primitive**: a workflow triggered
  on `engine.task.failed` remediates failures automatically.
- Tests: **+9** (trigger cron create/replace/manual-remove ×3, event
  arm-both-scopes + deactivate ×2, remove/degrade ×2, scheduler workflow-branch
  ×2). api **532 → 541**.

## LIVE PROOF (embedded boot, real Ollama)
1. **Cron trigger**: POST /workflows with `trigger:{type:"cron",cron:"* * * * *"}`
   → the schedule list gained `workflow:cmsf4ffa2…` (`kind:cron`,
   `workflowId:<the workflow>`, `enabled:true`) — auto-armed on create. At the
   next minute boundary the scheduler fired it → a WorkflowRun appeared → ran
   on Ollama. First attempt hit `maxSteps:2` because the cold-loaded 7b
   rambled (honest record: `Reached max steps (2) without completing`) — the
   EVENT-triggered run with the same prompt completed, proving the model
   variance, not the wiring.
2. **PUT re-sync**: updating the workflow re-created the schedule
   (`cmsf4htay…`, workflowId preserved) → next boundary → run **completed**
   (`status=completed error=None steps=1`).
3. **Event trigger = incident response**: workflow with
   `trigger:{type:"event",event:"engine.task.failed"}` → submitted a doomed
   task (unknown model → terminal 404) → the failure event fired the workflow
   → run **completed** (`incident-response-remediated`).

## Gates
api 541 (+9) · typecheck + build clean · full four-gate 20/20 in the
round-close pass. No browser pass this round (the wiring is API-side; the
workflow builder UI was browser-proven in round 3.3).
