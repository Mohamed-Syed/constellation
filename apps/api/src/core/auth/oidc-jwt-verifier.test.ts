import { generateKeyPairSync, createSign, constants, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompositeTokenVerifier } from "./composite-token-verifier.service.js";
import { OidcJwtVerifier } from "./oidc-jwt-verifier.service.js";
import type { AuthPrincipal, TokenVerifier } from "./token-verifier.js";

/**
 * Tests for the P3 SSO seam. The security-critical assertions here are the
 * NEGATIVE ones — an OIDC verifier that accepts a token it shouldn't is a
 * full authentication bypass, so `alg: none`, HMAC downgrade, wrong issuer,
 * wrong audience, expiry and signature tampering each get an explicit test.
 *
 * No network: `fetch` is stubbed to serve a JWKS built from a keypair
 * generated in-process.
 */

const ISSUER = "https://idp.example.test/realms/constellation";
const AUDIENCE = "constellation";
const KID = "test-key-1";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Mint a JWS. `alg` is written into the header verbatim so we can forge bad ones. */
function makeToken(
  payload: Record<string, unknown>,
  opts: { alg?: string; kid?: string | null; sign?: boolean; tamper?: boolean } = {},
): string {
  const alg = opts.alg ?? "RS256";
  const header: Record<string, unknown> = { alg, typ: "JWT" };
  if (opts.kid !== null) header.kid = opts.kid ?? KID;

  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${head}.${body}`;

  if (opts.sign === false) return `${signingInput}.`;

  const signer = createSign("sha256");
  signer.update(signingInput);
  let sig = signer.sign(privateKey);
  if (opts.tamper) sig = Buffer.concat([sig.subarray(0, sig.length - 1), Buffer.from([sig[sig.length - 1]! ^ 0xff])]);
  return `${signingInput}.${sig.toString("base64url")}`;
}

function validClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: "user-abc",
    email: "sso.user@example.test",
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + 300,
    roles: ["admin"],
    permissions: ["platform:admin"],
    ...over,
  };
}

const jwks = {
  keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, use: "sig", alg: "RS256" }],
};

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.href;
      if (href.endsWith("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify({ issuer: ISSUER, jwks_uri: `${ISSUER}/protocol/openid-connect/certs` }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (href.endsWith("/certs")) {
        return new Response(JSON.stringify(jwks), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

const ENV_KEYS = [
  "OIDC_ISSUER_URL",
  "OIDC_AUDIENCE",
  "OIDC_JWKS_URI",
  "OIDC_ROLES_CLAIM",
  "OIDC_PERMISSIONS_CLAIM",
  "OIDC_EMAIL_CLAIM",
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  stubFetch();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Construct the verifier AFTER env is set (config is read in field initializers). */
function enabledVerifier(extra: Record<string, string> = {}): OidcJwtVerifier {
  process.env.OIDC_ISSUER_URL = ISSUER;
  process.env.OIDC_AUDIENCE = AUDIENCE;
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
  return new OidcJwtVerifier();
}

describe("OidcJwtVerifier — disabled by default", () => {
  it("is inert and returns null when OIDC_ISSUER_URL is unset", async () => {
    delete process.env.OIDC_ISSUER_URL;
    const v = new OidcJwtVerifier();
    expect(v.isEnabled).toBe(false);
    expect(v.describe()).toContain("disabled");
    await expect(v.verify(makeToken(validClaims()))).resolves.toBeNull();
  });

  it("never calls the network while disabled", async () => {
    delete process.env.OIDC_ISSUER_URL;
    const v = new OidcJwtVerifier();
    await v.verify(makeToken(validClaims()));
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("OidcJwtVerifier — happy path", () => {
  it("accepts a correctly signed token and maps claims to a principal", async () => {
    const v = enabledVerifier();
    const principal = await v.verify(makeToken(validClaims()));
    expect(principal).toEqual<AuthPrincipal>({
      id: "user-abc",
      email: "sso.user@example.test",
      roles: ["admin"],
      permissions: ["platform:admin"],
    });
  });

  it("discovers the JWKS URI from the issuer's well-known document", async () => {
    const v = enabledVerifier();
    await v.verify(makeToken(validClaims()));
    const called = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(called.some((u) => u.endsWith("/.well-known/openid-configuration"))).toBe(true);
    expect(called.some((u) => u.endsWith("/certs"))).toBe(true);
  });

  it("caches keys across calls instead of refetching per token", async () => {
    const v = enabledVerifier();
    await v.verify(makeToken(validClaims()));
    const afterFirst = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    await v.verify(makeToken(validClaims({ sub: "user-def" })));
    expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(afterFirst);
  });

  it("honours custom claim names", async () => {
    const v = enabledVerifier({
      OIDC_ROLES_CLAIM: "groups",
      OIDC_PERMISSIONS_CLAIM: "scopes",
      OIDC_EMAIL_CLAIM: "upn",
    });
    const p = await v.verify(
      makeToken(validClaims({ roles: undefined, permissions: undefined, email: undefined, groups: ["ops"], scopes: "a:b c:d", upn: "x@y.z" })),
    );
    expect(p?.roles).toEqual(["ops"]);
    expect(p?.permissions).toEqual(["a:b", "c:d"]);
    expect(p?.email).toBe("x@y.z");
  });
});

describe("OidcJwtVerifier — rejects unsafe/invalid tokens (security critical)", () => {
  it('rejects alg "none" (unsigned token forgery)', async () => {
    const v = enabledVerifier();
    await expect(v.verify(makeToken(validClaims(), { alg: "none", sign: false }))).resolves.toBeNull();
  });

  it("rejects HS256 (symmetric downgrade using the public key as the secret)", async () => {
    const v = enabledVerifier();
    await expect(v.verify(makeToken(validClaims(), { alg: "HS256" }))).resolves.toBeNull();
  });

  it("rejects a token from a different issuer", async () => {
    const v = enabledVerifier();
    await expect(v.verify(makeToken(validClaims({ iss: "https://evil.example" })))).resolves.toBeNull();
  });

  it("rejects a token for a different audience", async () => {
    const v = enabledVerifier();
    await expect(v.verify(makeToken(validClaims({ aud: "some-other-app" })))).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const v = enabledVerifier();
    const now = Math.floor(Date.now() / 1000);
    await expect(v.verify(makeToken(validClaims({ exp: now - 3600 })))).resolves.toBeNull();
  });

  it("rejects a not-yet-valid token (nbf in the future)", async () => {
    const v = enabledVerifier();
    const now = Math.floor(Date.now() / 1000);
    await expect(v.verify(makeToken(validClaims({ nbf: now + 3600 })))).resolves.toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const v = enabledVerifier();
    await expect(v.verify(makeToken(validClaims(), { tamper: true }))).resolves.toBeNull();
  });

  it("rejects a token signed by an unknown key (kid not in the JWKS)", async () => {
    const v = enabledVerifier();
    await expect(v.verify(makeToken(validClaims(), { kid: "not-a-real-kid" }))).resolves.toBeNull();
  });

  it("rejects a token with no subject", async () => {
    const v = enabledVerifier();
    await expect(v.verify(makeToken(validClaims({ sub: undefined })))).resolves.toBeNull();
  });

  it("rejects malformed input", async () => {
    const v = enabledVerifier();
    for (const bad of ["", "abc", "a.b", "a.b.c.d", "!!!.???.***"]) {
      await expect(v.verify(bad)).resolves.toBeNull();
    }
  });

  it("returns null (never throws) when the IdP is unreachable", async () => {
    const v = enabledVerifier();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(v.verify(makeToken(validClaims()))).resolves.toBeNull();
  });
});

describe("CompositeTokenVerifier", () => {
  const principal: AuthPrincipal = { id: "u1", email: "local@x", roles: ["admin"], permissions: ["platform:admin"] };

  function fakeVerifier(result: AuthPrincipal | null, onCall?: () => void): TokenVerifier {
    return {
      verify: vi.fn(async () => {
        onCall?.();
        return result;
      }),
    };
  }

  it("returns the local principal without consulting OIDC", async () => {
    const oidc = enabledVerifier();
    const oidcSpy = vi.spyOn(oidc, "verify");
    const composite = new CompositeTokenVerifier(fakeVerifier(principal) as never, oidc);
    await expect(composite.verify("tok")).resolves.toEqual(principal);
    expect(oidcSpy).not.toHaveBeenCalled();
  });

  it("falls through to OIDC when local declines", async () => {
    const oidc = enabledVerifier();
    const composite = new CompositeTokenVerifier(fakeVerifier(null) as never, oidc);
    const result = await composite.verify(makeToken(validClaims()));
    expect(result?.id).toBe("user-abc");
  });

  it("skips OIDC entirely when SSO is not configured", async () => {
    delete process.env.OIDC_ISSUER_URL;
    const oidc = new OidcJwtVerifier();
    const oidcSpy = vi.spyOn(oidc, "verify");
    const composite = new CompositeTokenVerifier(fakeVerifier(null) as never, oidc);
    await expect(composite.verify("tok")).resolves.toBeNull();
    expect(oidcSpy).not.toHaveBeenCalled();
  });

  it("treats a throwing verifier as declined rather than failing the request", async () => {
    const throwing: TokenVerifier = { verify: vi.fn(async () => { throw new Error("boom"); }) };
    delete process.env.OIDC_ISSUER_URL;
    const composite = new CompositeTokenVerifier(throwing as never, new OidcJwtVerifier());
    await expect(composite.verify("tok")).resolves.toBeNull();
  });
});
