/**
 * Shared error-to-message utilities for the engine + mesh services.
 * Consolidates the `asMessage` and (mesh) `deepestCauseMessage` functions that
 * were previously copy-pasted across engine.controller / mcp-client / scheduler
 * / supervisor / mesh — the code-quality round (Phase 4.0 CQ) dedupe.
 */

/** Flatten any thrown value to a safe, one-line string. */
export function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Walk undici's nested fetch failure chain (TypeError "fetch failed" ->
 * AggregateError -> errors[] -> real Error) and return the DEEPEST usable
 * message, so a dead peer surfaces "connect ECONNREFUSED ..." rather than
 * the top-level "fetch failed" wrapper. Falls back to the top-level message.
 */
export function deepestCauseMessage(err: unknown): string {
  let current = err;
  const seen = new Set<unknown>();
  for (let i = 0; i < 8 && !seen.has(current); i++) {
    seen.add(current);
    if (current instanceof AggregateError && current.errors?.length) {
      current = current.errors[0];
      continue;
    }
    if (current instanceof Error && current.cause) {
      current = current.cause;
      continue;
    }
    break;
  }
  return current instanceof Error ? current.message : String(current);
}
