import { afterEach, describe, expect, it } from "vitest";
import type { Response } from "express";
import {
  AUTH_COOKIE_NAME_DEFAULT,
  authCookieName,
  clearAuthCookie,
  readAuthCookie,
  setAuthCookie,
} from "./auth-cookie.js";

const originalName = process.env.AUTH_COOKIE_NAME;
const originalNodeEnv = process.env.NODE_ENV;

/**
 * Offline tests for the zero-dep httpOnly auth-cookie helpers (Platform
 * hardening v0.6). These are pure string/header functions — no DI, no DB,
 * no Express instance — so they unit-test directly.
 */
function fakeResponse(): Response {
  const res = { setHeader: () => {} } as unknown as Response;
  return res;
}

afterEach(() => {
  if (originalName === undefined) delete process.env.AUTH_COOKIE_NAME;
  else process.env.AUTH_COOKIE_NAME = originalName;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("authCookieName", () => {
  it("defaults to constellation_token", () => {
    delete process.env.AUTH_COOKIE_NAME;
    expect(authCookieName()).toBe(AUTH_COOKIE_NAME_DEFAULT);
  });

  it("honours AUTH_COOKIE_NAME override", () => {
    process.env.AUTH_COOKIE_NAME = "my_session";
    expect(authCookieName()).toBe("my_session");
  });

  it("falls back to the default for a blank override", () => {
    process.env.AUTH_COOKIE_NAME = "   ";
    expect(authCookieName()).toBe(AUTH_COOKIE_NAME_DEFAULT);
  });
});

describe("setAuthCookie", () => {
  it("sets an httpOnly, SameSite=Lax cookie with Path=/", () => {
    let header = "";
    const res = { setHeader: (_n: string, h: string) => (header = h) } as unknown as Response;
    setAuthCookie(res, "abc.123");
    expect(header).toContain("constellation_token=abc.123");
    expect(header).toContain("HttpOnly");
    // httpOnly same-site attribute value is case-insensitive (lax == Lax).
    expect(header.toLowerCase()).toContain("samesite=lax");
    expect(header).toContain("Path=/");
  });

  it("does NOT set Secure in non-production (so localhost http works)", () => {
    let header = "";
    const res = { setHeader: (_n: string, h: string) => (header = h) } as unknown as Response;
    delete process.env.NODE_ENV;
    setAuthCookie(res, "t");
    expect(header).not.toContain("Secure");
  });

  it("sets Secure when NODE_ENV=production", () => {
    let header = "";
    const res = { setHeader: (_n: string, h: string) => (header = h) } as unknown as Response;
    process.env.NODE_ENV = "production";
    setAuthCookie(res, "t");
    expect(header).toContain("Secure");
  });

  it("uses the configured cookie name", () => {
    let header = "";
    const res = { setHeader: (_n: string, h: string) => (header = h) } as unknown as Response;
    process.env.AUTH_COOKIE_NAME = "alt_session";
    setAuthCookie(res, "t");
    expect(header).toContain("alt_session=t");
    expect(header).not.toContain("constellation_token=");
  });
});

describe("clearAuthCookie", () => {
  it("sets Max-Age=0 to expire the cookie", () => {
    let header = "";
    const res = { setHeader: (_n: string, h: string) => (header = h) } as unknown as Response;
    clearAuthCookie(res);
    expect(header).toContain("constellation_token=");
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
  });

  it("reflects Secure in production", () => {
    let header = "";
    const res = { setHeader: (_n: string, h: string) => (header = h) } as unknown as Response;
    process.env.NODE_ENV = "production";
    clearAuthCookie(res);
    expect(header).toContain("Secure");
  });
});

describe("readAuthCookie", () => {
  it("returns undefined for an absent header", () => {
    expect(readAuthCookie(undefined)).toBeUndefined();
    expect(readAuthCookie("")).toBeUndefined();
    expect(readAuthCookie("other=1")).toBeUndefined();
  });

  it("reads the token back out of a Cookie header", () => {
    process.env.AUTH_COOKIE_NAME = "constellation_token";
    expect(readAuthCookie("constellation_token=abc.123; other=1")).toBe("abc.123");
  });

  it("round-trips a token that was encodeURIComponent'd", () => {
    const token = "a.b.c-eyJhbGciOiJIUzI1NiJ9.part.12";
    const encoded = encodeURIComponent(token);
    const header = `${AUTH_COOKIE_NAME_DEFAULT}=${encoded}`;
    expect(readAuthCookie(header)).toBe(token);
  });

  it("respects the configured name when parsing", () => {
    process.env.AUTH_COOKIE_NAME = "alt_session";
    expect(readAuthCookie("alt_session=z")).toBe("z");
    expect(readAuthCookie("constellation_token=z")).toBeUndefined();
  });

  it("returns undefined for a malformed percent-encoding value", () => {
    expect(readAuthCookie(`constellation_token=%zz`)).toBeUndefined();
  });
});
