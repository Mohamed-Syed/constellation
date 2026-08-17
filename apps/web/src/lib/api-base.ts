/**
 * The portal's single source of truth for the API base URL.
 *
 * D-2 fix (Engine v0.1 Task 4): every portal API client used to default to
 * http://localhost:4000 — the port a FOREIGN process (e.g. Looper's LiteLLM
 * gateway) squats on this host, answering with VALID JSON that is NOT this
 * product. The api is published on 4001; the default is flipped here, once,
 * and every client imports it.
 *
 * `NEXT_PUBLIC_API_URL` still overrides (Compose/CI set it to the container
 * host). See `apps/api/src/core/health/identity.controller.ts` for the
 * endpoint this module asserts against.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001/api";

export interface IdentityProbe {
  /** true when the API at API_BASE identified itself as Constellation. */
  ok: boolean;
  /** The URL that was probed. */
  url: string;
  /** What the API claimed to be (undefined if it answered no JSON). */
  product?: string;
}

/**
 * Lightweight startup identity assertion (D-2): call GET /api/identity once;
 * the portal only trusts the API if it answers { product: "constellation" }.
 * Anything else — a foreign process on the port, a stale deployment, a 404 —
 * is reported so the shell can show a clear "connected to the wrong API"
 * banner instead of silently rendering another product's data.
 */
export async function probeApiIdentity(timeoutMs = 5000): Promise<IdentityProbe> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_BASE}/identity`, { signal: controller.signal, cache: "no-store" });
      if (!res.ok) return { ok: false, url: API_BASE };
      const body = (await res.json()) as { product?: string };
      return { ok: body.product === "constellation", url: API_BASE, product: body.product };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: false, url: API_BASE };
  }
}
