import {
  constants,
  createHash,
  createPublicKey,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { AuthPrincipal, TokenVerifier } from "./token-verifier.js";

/**
 * OIDC / JWKS bearer-token verifier — the SSO half of P3 portal federation.
 *
 * WHY THIS EXISTS: `LocalJwtVerifier` only understands tokens this platform
 * itself signed. Once an external IdP (Keycloak/Authentik/Entra) fronts the
 * portal, the browser arrives holding *that* provider's JWT. This verifier
 * validates those, and `CompositeTokenVerifier` runs both so local logins
 * keep working during and after the migration.
 *
 * DISABLED BY DEFAULT. With no `OIDC_ISSUER_URL` set, `isEnabled` is false,
 * `verify()` short-circuits to `null`, and the platform behaves exactly as
 * it did before this file existed. That keeps the "boot with nothing
 * configured" invariant intact.
 *
 * ZERO NEW DEPENDENCIES — deliberate. Node 22 ships everything required:
 * `fetch` for discovery/JWKS and `node:crypto` for JWK import + signature
 * verification. Adding `jose`/`jwks-rsa` would mean a lockfile change, which
 * this round forbids. The trade-off is that we implement JWS validation by
 * hand; it is kept strict and narrow on purpose (see `verify`).
 *
 * SECURITY NOTES (each of these is a real CVE class in hand-rolled JWT code):
 *  - The `alg` comes from an allow-list of asymmetric algorithms only. `none`
 *    and every HMAC variant are rejected outright, so a token cannot
 *    downgrade itself into being "verified" with a public key as the secret.
 *  - `iss` is compared against the configured issuer, and `aud` must contain
 *    the configured audience when one is set.
 *  - `exp`/`nbf` are enforced with a small configurable clock skew.
 *  - JWKS keys are cached by `kid`, refetched at most once per
 *    `minRefetchIntervalMs` on an unknown `kid` (bounded so a bogus-kid flood
 *    can't turn into a request amplifier against the IdP).
 */
@Injectable()
export class OidcJwtVerifier implements TokenVerifier {
  private readonly logger = new Logger(OidcJwtVerifier.name);

  private readonly issuer = process.env.OIDC_ISSUER_URL?.trim().replace(/\/$/, "") ?? "";
  private readonly audience = process.env.OIDC_AUDIENCE?.trim() ?? "";
  private readonly configuredJwksUri = process.env.OIDC_JWKS_URI?.trim() ?? "";
  private readonly rolesClaim = process.env.OIDC_ROLES_CLAIM?.trim() || "roles";
  private readonly permissionsClaim = process.env.OIDC_PERMISSIONS_CLAIM?.trim() || "permissions";
  private readonly emailClaim = process.env.OIDC_EMAIL_CLAIM?.trim() || "email";
  private readonly clockSkewSec = numberFromEnv("OIDC_CLOCK_SKEW_SEC", 60);
  private readonly jwksTtlMs = numberFromEnv("OIDC_JWKS_CACHE_TTL_MS", 10 * 60 * 1000);
  private readonly minRefetchIntervalMs = numberFromEnv("OIDC_JWKS_MIN_REFETCH_MS", 30 * 1000);
  private readonly httpTimeoutMs = numberFromEnv("OIDC_HTTP_TIMEOUT_MS", 5000);

  /** Only asymmetric algorithms. `none`/HS* are never acceptable here. */
  private static readonly ALLOWED_ALGS: Record<string, { name: string; hash: string }> = {
    RS256: { name: "rsa", hash: "sha256" },
    RS384: { name: "rsa", hash: "sha384" },
    RS512: { name: "rsa", hash: "sha512" },
    PS256: { name: "rsa-pss", hash: "sha256" },
    PS384: { name: "rsa-pss", hash: "sha384" },
    PS512: { name: "rsa-pss", hash: "sha512" },
    ES256: { name: "ec", hash: "sha256" },
    ES384: { name: "ec", hash: "sha384" },
    ES512: { name: "ec", hash: "sha512" },
  };

  private keyCache = new Map<string, KeyObject>();
  private keyCacheExpiresAt = 0;
  private lastFetchAt = 0;
  private inFlight: Promise<void> | undefined;
  private resolvedJwksUri = "";

  /** True only when an issuer is configured; otherwise this verifier is inert. */
  get isEnabled(): boolean {
    return this.issuer.length > 0;
  }

  /** Describes the active configuration for the startup log / diagnostics. */
  describe(): string {
    if (!this.isEnabled) return "disabled (OIDC_ISSUER_URL unset)";
    const aud = this.audience ? `audience="${this.audience}"` : "audience=<any> (OIDC_AUDIENCE unset)";
    return `issuer="${this.issuer}", ${aud}`;
  }

  async verify(token: string): Promise<AuthPrincipal | null> {
    if (!this.isEnabled) return null;

    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];

      const header = decodeJsonSegment<{ alg?: string; kid?: string; typ?: string }>(rawHeader);
      const payload = decodeJsonSegment<Record<string, unknown>>(rawPayload);
      if (!header || !payload) return null;

      const alg = header.alg ?? "";
      const spec = OidcJwtVerifier.ALLOWED_ALGS[alg];
      if (!spec) {
        // Covers "none" and every HS* symmetric variant.
        this.logger.debug(`Rejecting token: unsupported/unsafe alg "${alg}".`);
        return null;
      }

      // --- Claim checks BEFORE the expensive signature check where cheap ---
      const iss = typeof payload.iss === "string" ? payload.iss.replace(/\/$/, "") : "";
      if (iss !== this.issuer) {
        this.logger.debug(`Rejecting token: issuer "${iss}" != configured "${this.issuer}".`);
        return null;
      }
      if (!this.audienceMatches(payload.aud)) {
        this.logger.debug("Rejecting token: audience mismatch.");
        return null;
      }
      const now = Math.floor(Date.now() / 1000);
      if (typeof payload.exp === "number" && now > payload.exp + this.clockSkewSec) {
        this.logger.debug("Rejecting token: expired.");
        return null;
      }
      if (typeof payload.nbf === "number" && now + this.clockSkewSec < payload.nbf) {
        this.logger.debug("Rejecting token: not yet valid (nbf).");
        return null;
      }

      // --- Signature ---
      const key = await this.resolveKey(header.kid);
      if (!key) {
        this.logger.warn("No usable JWKS key for this token (unknown kid or JWKS unreachable).");
        return null;
      }

      const signingInput = Buffer.from(`${rawHeader}.${rawPayload}`, "utf8");
      const signature = base64UrlToBuffer(rawSignature);
      if (!this.verifySignature(alg, spec, key, signingInput, signature)) {
        this.logger.debug("Rejecting token: signature verification failed.");
        return null;
      }

      return this.toPrincipal(payload);
    } catch (err) {
      this.logger.debug(`OIDC verification error: ${asMessage(err)}`);
      return null;
    }
  }

  private verifySignature(
    alg: string,
    spec: { name: string; hash: string },
    key: KeyObject,
    data: Buffer,
    signature: Buffer,
  ): boolean {
    try {
      if (spec.name === "ec") {
        // JWS ES* signatures are raw r||s; Node expects DER unless told otherwise.
        return cryptoVerify(spec.hash, data, { key, dsaEncoding: "ieee-p1363" }, signature);
      }
      if (spec.name === "rsa-pss") {
        // PS* requires explicit PSS padding with a salt length equal to the
        // digest size (RFC 7518 §3.5). Without these options Node would
        // default to PKCS#1 v1.5 and reject every valid PS* signature.
        return cryptoVerify(
          spec.hash,
          data,
          {
            key,
            padding: constants.RSA_PKCS1_PSS_PADDING,
            saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
          },
          signature,
        );
      }
      return cryptoVerify(spec.hash, data, key, signature);
    } catch (err) {
      this.logger.debug(`Signature check threw for alg ${alg}: ${asMessage(err)}`);
      return false;
    }
  }

  private audienceMatches(aud: unknown): boolean {
    if (!this.audience) return true; // not configured → don't enforce
    if (typeof aud === "string") return aud === this.audience;
    if (Array.isArray(aud)) return aud.some((a) => a === this.audience);
    return false;
  }

  private toPrincipal(payload: Record<string, unknown>): AuthPrincipal | null {
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    if (!sub) return null;
    const email =
      typeof payload[this.emailClaim] === "string"
        ? (payload[this.emailClaim] as string)
        : typeof payload.preferred_username === "string"
          ? payload.preferred_username
          : sub;

    return {
      id: sub,
      email,
      roles: extractStringArray(payload[this.rolesClaim]),
      permissions: extractStringArray(payload[this.permissionsClaim]),
    };
  }

  // ------------------------------------------------------------------
  // JWKS handling
  // ------------------------------------------------------------------

  private async resolveKey(kid: string | undefined): Promise<KeyObject | undefined> {
    const fresh = Date.now() < this.keyCacheExpiresAt;
    if (fresh) {
      const hit = this.pickKey(kid);
      if (hit) return hit;
    }
    await this.refreshKeys();
    return this.pickKey(kid);
  }

  private pickKey(kid: string | undefined): KeyObject | undefined {
    if (kid) return this.keyCache.get(kid);
    // No `kid` in the header: only unambiguous when the set holds exactly one key.
    if (this.keyCache.size === 1) return this.keyCache.values().next().value;
    return undefined;
  }

  /** Refetch the JWKS, coalescing concurrent callers and rate-limiting retries. */
  private async refreshKeys(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (Date.now() - this.lastFetchAt < this.minRefetchIntervalMs && this.keyCacheExpiresAt > 0) {
      return; // too soon since the last attempt — don't hammer the IdP
    }
    this.inFlight = this.doRefreshKeys().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async doRefreshKeys(): Promise<void> {
    this.lastFetchAt = Date.now();
    try {
      const uri = await this.jwksUri();
      if (!uri) return;
      const body = await this.fetchJson<{ keys?: unknown[] }>(uri);
      const keys = Array.isArray(body?.keys) ? body.keys : [];
      const next = new Map<string, KeyObject>();

      for (const jwk of keys) {
        if (!isRecord(jwk)) continue;
        const use = typeof jwk.use === "string" ? jwk.use : undefined;
        if (use && use !== "sig") continue; // encryption keys are not signing keys
        try {
          const keyObject = createPublicKey({ key: jwk as never, format: "jwk" });
          const kid = typeof jwk.kid === "string" && jwk.kid ? jwk.kid : thumbprint(jwk);
          next.set(kid, keyObject);
        } catch (err) {
          this.logger.debug(`Skipping unusable JWK: ${asMessage(err)}`);
        }
      }

      if (next.size === 0) {
        this.logger.warn(`JWKS at ${uri} contained no usable signing keys.`);
        return;
      }
      this.keyCache = next;
      this.keyCacheExpiresAt = Date.now() + this.jwksTtlMs;
      this.logger.log(`Loaded ${next.size} OIDC signing key(s) from ${uri}.`);
    } catch (err) {
      this.logger.warn(`Failed to refresh OIDC JWKS — tokens will be rejected: ${asMessage(err)}`);
    }
  }

  /** Configured JWKS URI, else discovered from the issuer's well-known document. */
  private async jwksUri(): Promise<string> {
    if (this.configuredJwksUri) return this.configuredJwksUri;
    if (this.resolvedJwksUri) return this.resolvedJwksUri;

    const discoveryUrl = `${this.issuer}/.well-known/openid-configuration`;
    const doc = await this.fetchJson<{ jwks_uri?: string }>(discoveryUrl);
    const uri = typeof doc?.jwks_uri === "string" ? doc.jwks_uri : "";
    if (!uri) {
      this.logger.warn(`OIDC discovery at ${discoveryUrl} returned no jwks_uri.`);
      return "";
    }
    this.resolvedJwksUri = uri;
    return uri;
  }

  private async fetchJson<T>(url: string): Promise<T | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.httpTimeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
      if (!res.ok) {
        this.logger.warn(`GET ${url} → HTTP ${res.status}`);
        return undefined;
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function decodeJsonSegment<T>(segment: string): T | undefined {
  try {
    return JSON.parse(base64UrlToBuffer(segment).toString("utf8")) as T;
  } catch {
    return undefined;
  }
}

function base64UrlToBuffer(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function extractStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value.trim()) return value.trim().split(/[\s,]+/);
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** RFC 7638-style fallback identifier for a JWK that carries no `kid`. */
function thumbprint(jwk: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(jwk)).digest("base64url");
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
