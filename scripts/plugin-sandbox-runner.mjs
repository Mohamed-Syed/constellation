#!/usr/bin/env node
// Sandboxed plugin invoke runner — spawned by PluginSandboxService (Phase 2.0
// 2.7). Reads a job file { entry, pluginId, tool, args, settings }, imports
// the plugin's compiled entry, builds a MINIMAL PluginContext (config +
// logger only — no db, no events, no memory: least privilege), calls
// runtime.invokeTool(tool, args, ctx), and prints exactly ONE JSON line (the
// ToolResult) to stdout. The parent enforces the wall-clock timeout, the
// memory cap (--max-old-space-size), and the result-size cap; this script
// never touches the network beyond what the plugin itself does.
//
// The context mirrors the real runtime's resolution faithfully:
//   config.get(key, fallback) = the manifest setting's non-empty default,
//   else the caller's fallback — env fallbacks are the PLUGIN's own
//   convention (e.g. graphify reads GRAPHIFY_PLUGIN_MCP_URL internally) and
//   work here because the child inherits the parent's environment.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const jobFile = process.argv[2];
if (!jobFile) {
  process.stdout.write(JSON.stringify({ ok: false, error: "sandbox runner: no job file given" }));
  process.exit(0);
}

let job;
try {
  job = JSON.parse(readFileSync(jobFile, "utf8"));
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, error: `sandbox runner: job read failed: ${err instanceof Error ? err.message : String(err)}` }));
  process.exit(0);
}

const settings = Array.isArray(job.settings) ? job.settings : [];

function emit(result) {
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

function fail(message) {
  emit({ ok: false, error: message });
}

function log(line) {
  process.stderr.write(`[sandbox:${job.pluginId}] ${String(line)}\n`);
}

const ctx = {
  logger: {
    info: (m) => log(m),
    log: (m) => log(m),
    warn: (m) => log(`WARN ${m}`),
    error: (m) => log(`ERROR ${m}`),
    debug: (m) => log(`DEBUG ${m}`),
  },
  config: {
    get: (key, fallback) => {
      const setting = settings.find((s) => s && s.key === key);
      if (setting && typeof setting.default === "string" && setting.default !== "") return setting.default;
      if (setting && typeof setting.default === "number" && Number.isFinite(setting.default)) return setting.default;
      return fallback;
    },
  },
  // Deliberately ABSENT: a sandboxed tool must not reach the platform's DB,
  // event bus, or memory. A plugin that touches ctx.db / ctx.events / ctx.memory
  // gets an honest runtime error from the child, not platform access.
  events: { emit: async () => {}, on: () => () => {} },
  db: undefined,
  memory: undefined,
};

try {
  const mod = await import(pathToFileURL(job.entry).href);
  const runtime = mod.default ?? {};
  if (typeof runtime.invokeTool !== "function") {
    fail(`sandbox: plugin "${job.pluginId}" implements no invokeTool()`);
  }
  const result = await runtime.invokeTool(job.tool, job.args ?? {}, ctx);
  if (!result || typeof result !== "object" || typeof result.ok !== "boolean") {
    fail(`sandbox: plugin "${job.pluginId}" returned a malformed ToolResult for "${job.tool}"`);
  }
  emit(result);
} catch (err) {
  fail(`sandbox: plugin "${job.pluginId}" threw: ${err instanceof Error ? err.message : String(err)}`);
}
