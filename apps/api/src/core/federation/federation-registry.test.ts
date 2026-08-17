import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FederationRegistryService } from "./federation-registry.service.js";
import { interpolateEnv, parseSimpleYaml, YamlParseError } from "./simple-yaml.js";

/**
 * Covers the P3 federation registry. The most valuable test here is
 * `parses the REAL config/modules.yaml` — the hand-written parser only earns
 * its place if it handles the actual shipped file, not just toy fixtures.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const REAL_REGISTRY = resolve(REPO_ROOT, "config", "modules.yaml");

describe("parseSimpleYaml", () => {
  it("parses nested mappings", () => {
    expect(parseSimpleYaml("a: 1\nb:\n  c: two\n  d: true\n")).toEqual({ a: 1, b: { c: "two", d: true } });
  });

  it("parses sequences of scalars", () => {
    expect(parseSimpleYaml("items:\n  - one\n  - two\n")).toEqual({ items: ["one", "two"] });
  });

  it("parses sequences of mappings", () => {
    expect(parseSimpleYaml("list:\n  - id: a\n    n: 1\n  - id: b\n    n: 2\n")).toEqual({
      list: [
        { id: "a", n: 1 },
        { id: "b", n: 2 },
      ],
    });
  });

  it("parses a mapping nested inside a sequence item", () => {
    expect(parseSimpleYaml("l:\n  - id: a\n    p:\n      path: /x\n      ok: false\n")).toEqual({
      l: [{ id: "a", p: { path: "/x", ok: false } }],
    });
  });

  it("accepts a sequence indented at the same level as its key", () => {
    expect(parseSimpleYaml("k:\n- a\n- b\n")).toEqual({ k: ["a", "b"] });
  });

  it("handles scalar types", () => {
    expect(parseSimpleYaml("s: text\nq: \"quoted\"\ni: 42\nf: 1.5\nt: true\nf2: false\nn: null\ne: ~\n")).toEqual({
      s: "text",
      q: "quoted",
      i: 42,
      f: 1.5,
      t: true,
      f2: false,
      n: null,
      e: null,
    });
  });

  it("strips full-line and trailing comments but not '#' inside quotes", () => {
    expect(parseSimpleYaml("# lead\na: 1 # trail\nb: \"has # hash\"\n")).toEqual({ a: 1, b: "has # hash" });
  });

  it("keeps a colon inside a quoted value", () => {
    expect(parseSimpleYaml('u: "http://x:8080/y"\n')).toEqual({ u: "http://x:8080/y" });
  });

  it("keeps a URL value unquoted", () => {
    expect(parseSimpleYaml("u: http://grafana:3000\n")).toEqual({ u: "http://grafana:3000" });
  });

  it("rejects unsupported constructs loudly instead of mis-parsing", () => {
    expect(() => parseSimpleYaml("a: [1, 2]\n")).toThrow(YamlParseError);
    expect(() => parseSimpleYaml("a: {b: 1}\n")).toThrow(YamlParseError);
    expect(() => parseSimpleYaml("a: |\n")).toThrow(YamlParseError);
    expect(() => parseSimpleYaml("\ta: 1\n")).toThrow(YamlParseError);
  });

  it("returns an empty mapping for an empty document", () => {
    expect(parseSimpleYaml("")).toEqual({});
    expect(parseSimpleYaml("# only a comment\n")).toEqual({});
  });
});

describe("interpolateEnv", () => {
  it("substitutes a set variable", () => {
    expect(interpolateEnv("${FOO}/x", { FOO: "bar" } as NodeJS.ProcessEnv)).toBe("bar/x");
  });

  it("falls back to the default when unset or empty", () => {
    expect(interpolateEnv("${NOPE:-fallback}", {} as NodeJS.ProcessEnv)).toBe("fallback");
    expect(interpolateEnv("${E:-fb}", { E: "" } as NodeJS.ProcessEnv)).toBe("fb");
  });

  it("yields an empty string for an unset variable with no default", () => {
    expect(interpolateEnv("${NOPE}", {} as NodeJS.ProcessEnv)).toBe("");
  });
});

describe("FederationRegistryService", () => {
  const saved = process.env.FEDERATION_REGISTRY_PATH;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.FEDERATION_REGISTRY_PATH;
    else process.env.FEDERATION_REGISTRY_PATH = saved;
    vi.restoreAllMocks();
  });

  function load(path: string): FederationRegistryService {
    process.env.FEDERATION_REGISTRY_PATH = path;
    const svc = new FederationRegistryService();
    svc.onModuleInit();
    return svc;
  }

  it("parses the REAL config/modules.yaml that ships with the repo", () => {
    const svc = load(REAL_REGISTRY);
    const all = svc.all();
    expect(all.length).toBeGreaterThanOrEqual(7);

    const ids = all.map((m) => m.id);
    for (const expected of ["grafana", "prometheus", "loki", "open-webui", "langflow", "keycloak", "coolify"]) {
      expect(ids).toContain(expected);
    }

    const grafana = svc.findById("grafana");
    expect(grafana).toMatchObject({
      name: "Grafana",
      category: "observability",
      upstream: "http://grafana:3000",
      path: "/tools/grafana",
      embeddable: true,
      sso: true,
      display: "tile",
      enabled: true,
    });
    expect(grafana?.requiresPermissions).toEqual(["core:observability:read"]);
  });

  it("applies file-level defaults and per-module overrides", () => {
    const svc = load(REAL_REGISTRY);
    // defaults: sso false → keycloak keeps false; grafana overrides to true
    expect(svc.findById("keycloak")?.sso).toBe(false);
    expect(svc.findById("grafana")?.sso).toBe(true);
    // display: hidden is set per-module on prometheus/loki
    expect(svc.findById("prometheus")?.display).toBe("hidden");
    expect(svc.findById("grafana")?.display).toBe("tile");
  });

  it("treats coolify as disabled until P5", () => {
    const svc = load(REAL_REGISTRY);
    expect(svc.findById("coolify")?.enabled).toBe(false);
    expect(svc.enabled().map((m) => m.id)).not.toContain("coolify");
  });

  it("interpolates ${VAR:-default} in upstream values", () => {
    const svc = load(REAL_REGISTRY);
    // COOLIFY_URL is unset in tests → the default applies.
    expect(svc.findById("coolify")?.upstream).toBe("http://localhost:8000");
  });

  it("reports registry status", () => {
    const svc = load(REAL_REGISTRY);
    const status = svc.status();
    expect(status.total).toBe(svc.all().length);
    expect(status.enabled).toBe(svc.enabled().length);
    expect(status.error).toBeUndefined();
  });

  it("degrades to zero modules when the file is missing (never throws)", () => {
    const svc = load(resolve(REPO_ROOT, "config", "__does_not_exist__.yaml"));
    expect(svc.all()).toEqual([]);
    expect(svc.enabled()).toEqual([]);
  });

  it("degrades to zero modules and records the error when the file is malformed", () => {
    const bad = resolve(REPO_ROOT, "apps", "api", "src", "core", "federation", "__bad_fixture__.yaml");
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(bad, "modules: [not, supported]\n");
    try {
      const svc = load(bad);
      expect(svc.all()).toEqual([]);
      expect(svc.status().error).toBeTruthy();
    } finally {
      fs.unlinkSync(bad);
    }
  });

  it("the real registry file contains no obvious secrets", () => {
    const text = readFileSync(REAL_REGISTRY, "utf8");
    // Only inspect actual `key: value` assignments — prose in comments (e.g.
    // "Nothing here is secret") must not trip the scan.
    const assignments = text
      .split(/\r?\n/)
      .map((l) => l.replace(/(^|\s)#.*$/, "").trim())
      .filter(Boolean);
    for (const line of assignments) {
      expect(line).not.toMatch(/^-?\s*password\s*:/i);
      expect(line).not.toMatch(/^-?\s*(client_?)?secret\s*:/i);
      expect(line).not.toMatch(/^-?\s*api[_-]?key\s*:/i);
      expect(line).not.toMatch(/^-?\s*token\s*:/i);
    }
  });
});
