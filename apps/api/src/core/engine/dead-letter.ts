/**
 * Engine v0.5 — Dead-letter classification.
 *
 * When a task fails terminally, exhausts its retries, or is deemed stalled by
 * the supervisor, the task row records an honest `failureClassification` so a
 * structured dead-letter trail exists independent of BullMQ's (removed-after-
 * fail) job. These constants are the single source of truth for the values;
 * the DB column stores the string values exactly as listed here.
 */
export type FailureClassification =
  | "terminal" // a non-retryable error (bad request, unknown model, max steps, token budget)
  | "transient_exhausted" // a transient error whose bounded retries all failed
  | "stalled" // the supervisor found it stuck running too long (orphaned job / worker stall)
  | "rejected"; // a paused task's tool call was rejected by a human

/** The failure classifications considered dead letters in the DLQ view. */
export const DEAD_LETTER_CLASSIFICATIONS: readonly FailureClassification[] = [
  "terminal",
  "transient_exhausted",
  "stalled",
  "rejected",
];

/** Default cap on rows returned by the dead-letter view (newest first). */
export const DEAD_LETTER_LIMIT = 100;

/** A classified dead letter, as surfaced by GET /api/engine/deadletters. */
export interface DeadLetterTask {
  id: string;
  title: string;
  status: string;
  error: string | null;
  classification: FailureClassification | null;
  actorId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}
