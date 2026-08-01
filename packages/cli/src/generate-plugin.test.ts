import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "@constellation/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generatePlugin, toKebabCase } from "./generate-plugin.js";

let pluginsRoot: string;

beforeEach(() => {
  pluginsRoot = mkdtempSync(join(tmpdir(), "constellation-cli-"));
});

afterEach(() => {
  rmSync(pluginsRoot, { recursive: true, force: true });
});

describe("toKebabCase", () => {
  it("converts PascalCase / camelCase", () => {
    expect(toKebabCase("MyCoolPlugin")).toBe("my-cool-plugin");
    expect(toKebabCase("myCoolPlugin")).toBe("my-cool-plugin");
  });

  it("converts space-separated names", () => {
    expect(toKebabCase("My Cool Plugin")).toBe("my-cool-plugin");
  });

  it("passes through already-kebab names", () => {
    expect(toKebabCase("my-cool-plugin")).toBe("my-cool-plugin");
  });

  it("strips invalid characters", () => {
    expect(toKebabCase("My_Cool!! Plugin##")).toBe("my-cool-plugin");
  });
});

describe("generatePlugin", () => {
  it("scaffolds a plugin whose manifest parses with the SDK's parseManifest", () => {
    const result = generatePlugin("My Cool Plugin", { pluginsRoot });

    expect(result.id).toBe("my-cool-plugin");
    expect(result.dir).toBe(join(pluginsRoot, "my-cool-plugin"));

    // parseManifest itself is authoritative: re-parse what generatePlugin
    // returned AND what actually landed on disk.
    expect(() => parseManifest(result.manifest)).not.toThrow();
    const onDisk = JSON.parse(readFileSync(join(result.dir, "plugin.manifest.json"), "utf8"));
    expect(() => parseManifest(onDisk)).not.toThrow();
    expect(onDisk.id).toBe("my-cool-plugin");
    expect(onDisk.minPlatformVersion).toBe(result.manifest.minPlatformVersion);
  });

  it("writes every expected file", () => {
    const result = generatePlugin("Widgets", { pluginsRoot });

    for (const file of ["plugin.manifest.json", "package.json", "tsconfig.json", "src/index.ts", "src/index.test.ts"]) {
      expect(existsSync(join(result.dir, file)), `expected ${file} to exist`).toBe(true);
    }

    const pkg = JSON.parse(readFileSync(join(result.dir, "package.json"), "utf8"));
    expect(pkg.name).toBe("@constellation/plugin-widgets");
    expect(pkg.dependencies["@constellation/plugin-sdk"]).toBe("workspace:*");

    const tsconfig = JSON.parse(readFileSync(join(result.dir, "tsconfig.json"), "utf8"));
    expect(tsconfig.compilerOptions.declaration).toBe(false);
    expect(tsconfig.compilerOptions.declarationMap).toBe(false);

    const indexTs = readFileSync(join(result.dir, "src", "index.ts"), "utf8");
    expect(indexTs).toContain("definePlugin");
    expect(indexTs).toContain("register");
    expect(indexTs).toContain("enable");
    expect(indexTs).toContain("health");
  });

  it("rejects a name that can't produce a valid id", () => {
    expect(() => generatePlugin("!!!", { pluginsRoot })).toThrow(/valid plugin id/);
  });

  it("refuses to overwrite an existing plugin directory without force", () => {
    generatePlugin("Duplicate", { pluginsRoot });
    expect(() => generatePlugin("Duplicate", { pluginsRoot })).toThrow(/already exists/);
  });

  it("overwrites when force is set", () => {
    generatePlugin("Duplicate", { pluginsRoot });
    expect(() => generatePlugin("Duplicate", { pluginsRoot, force: true })).not.toThrow();
  });
});
