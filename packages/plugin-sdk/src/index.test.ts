import { describe, expect, it } from "vitest";
import { parseManifest, safeParseManifest } from "./manifest.js";
import { CorePermissions, hasAllPermissions, hasPermission, isValidPermission, permissionSatisfies } from "./permissions.js";
import { PLATFORM_VERSION } from "./index.js";

const validManifest = {
  manifestVersion: 2,
  id: "hello-world",
  name: "Hello World",
  version: "0.1.0",
  minPlatformVersion: "0.1.0",
};

describe("manifest", () => {
  it("accepts a minimal valid manifest and applies defaults", () => {
    const m = parseManifest(validManifest);
    expect(m.id).toBe("hello-world");
    expect(m.permissions).toEqual([]);
    expect(m.entry).toBe("dist/index.js");
    expect(m.healthCheck).toBe("/health");
  });

  it("rejects a bad id (not kebab-case)", () => {
    const r = safeParseManifest({ ...validManifest, id: "Hello_World" });
    expect(r.success).toBe(false);
  });

  it("rejects a non-semver version", () => {
    const r = safeParseManifest({ ...validManifest, version: "one" });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed permission string", () => {
    const r = safeParseManifest({ ...validManifest, permissions: ["notscoped"] });
    expect(r.success).toBe(false);
  });
});

describe("manifest tools (agent plane)", () => {
  it("defaults `tools` to an empty array — a tool-less manifest stays valid (additive change)", () => {
    const m = parseManifest(validManifest);
    expect(m.tools).toEqual([]);
  });

  it("accepts a declared tool and defaults its description/inputSchema", () => {
    const m = parseManifest({
      ...validManifest,
      permissions: ["browser:navigate"],
      tools: [{ name: "browser.navigate", permission: "browser:navigate" }],
    });
    expect(m.tools).toHaveLength(1);
    expect(m.tools[0]).toEqual({
      name: "browser.navigate",
      description: "",
      inputSchema: {},
      permission: "browser:navigate",
      requiresApproval: false,
    });
  });

  it("preserves a full JSON-Schema inputSchema as opaque data", () => {
    const inputSchema = {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    };
    const m = parseManifest({
      ...validManifest,
      tools: [{ name: "browser.navigate", description: "Go to a URL", inputSchema, permission: "browser:navigate" }],
    });
    expect(m.tools[0]?.inputSchema).toEqual(inputSchema);
  });

  it("rejects an undotted tool name", () => {
    const r = safeParseManifest({
      ...validManifest,
      tools: [{ name: "navigate", permission: "browser:navigate" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a tool whose permission is not colon-scoped", () => {
    const r = safeParseManifest({
      ...validManifest,
      tools: [{ name: "browser.navigate", permission: "navigate" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a tool with no permission at all (least-privilege is mandatory)", () => {
    const r = safeParseManifest({ ...validManifest, tools: [{ name: "browser.navigate" }] });
    expect(r.success).toBe(false);
  });
});

describe("permissions", () => {
  it("matches exact and wildcard permissions", () => {
    expect(permissionSatisfies("billing:invoice:write", "billing:invoice:write")).toBe(true);
    expect(permissionSatisfies("billing:*", "billing:invoice:write")).toBe(true);
    expect(permissionSatisfies("billing:*", "users:read")).toBe(false);
  });

  it("platform:admin implies everything", () => {
    expect(hasPermission(["platform:admin"], "anything:goes")).toBe(true);
  });

  it("hasAllPermissions requires every one", () => {
    expect(hasAllPermissions(["a:read", "a:write"], ["a:read", "a:write"])).toBe(true);
    expect(hasAllPermissions(["a:read"], ["a:read", "a:write"])).toBe(false);
  });
});

describe("brain permissions (SDK 0.2.0, additive)", () => {
  it("exposes core:brain:read / core:brain:write", () => {
    expect(CorePermissions.BRAIN_READ).toBe("core:brain:read");
    expect(CorePermissions.BRAIN_WRITE).toBe("core:brain:write");
  });

  it("they are well-formed, colon-scoped permission strings", () => {
    expect(isValidPermission(CorePermissions.BRAIN_READ)).toBe(true);
    expect(isValidPermission(CorePermissions.BRAIN_WRITE)).toBe(true);
  });

  it("a manifest may declare them", () => {
    const m = parseManifest({
      ...validManifest,
      permissions: [CorePermissions.BRAIN_READ, CorePermissions.BRAIN_WRITE],
    });
    expect(m.permissions).toContain("core:brain:write");
  });

  it("core:* and platform:admin both satisfy them (wildcard semantics unchanged)", () => {
    expect(hasPermission(["core:*"], CorePermissions.BRAIN_READ)).toBe(true);
    expect(hasPermission(["platform:admin"], CorePermissions.BRAIN_WRITE)).toBe(true);
    expect(hasPermission(["core:brain:read"], CorePermissions.BRAIN_WRITE)).toBe(false);
  });

  it("the approval-gate change bumped the platform version to 0.3.0", () => {
    expect(PLATFORM_VERSION).toBe("0.3.0");
  });

  it("manifestVersion is now 2 — ADDITIVE contract change for the approval gate", () => {
    const m = parseManifest(validManifest);
    expect(m.manifestVersion).toBe(2);
  });

  it("tools default requiresApproval to false — behaviour unchanged unless opted in", () => {
    const m = parseManifest({
      ...validManifest,
      permissions: ["browser:act"],
      tools: [{ name: "browser.act", permission: "browser:act" }],
    });
    expect(m.tools[0]!.requiresApproval).toBe(false);
  });

  it("accepts an explicitly approval-required tool (human-in-the-loop flag)", () => {
    const m = parseManifest({
      ...validManifest,
      permissions: ["browser:act"],
      tools: [{ name: "browser.act", permission: "browser:act", requiresApproval: true }],
    });
    expect(m.tools[0]!.requiresApproval).toBe(true);
  });
});
