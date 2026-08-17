import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { LoadedPlugin, ToolResult } from "@constellation/plugin-sdk";

/**
 * Plugin sandbox (Phase 2.0 2.7) — PROCESS-mode isolation for plugin tool
 * invocations.
 *
 * Why a child process (not vm2/isolated-vm): vm2 is deprecated (unmaintained
 * since 2023, known escape CVEs); isolated-vm is a native addon needing a
 * node-gyp build (painful on this Windows host and a new dependency). A child
 * Node process gives REAL OS-level isolation: a crashing or hung plugin can
 * never take down the api process — the worst case is a killed child and an
 * honest `ok:false` ToolResult. Resource limits are enforced by the parent:
 *   - wall-clock timeout (PLUGIN_SANDBOX_TIMEOUT_MS, default 30s) → SIGKILL
 *   - heap cap (--max-old-space-size, PLUGIN_SANDBOX_MEMORY_MB, default 256)
 *   - result-size cap (PLUGIN_SANDBOX_MAX_RESULT_BYTES, default 1MB)
 * The child gets a MINIMAL PluginContext (config + logger only): no db, no
 * events, no memory — a sandboxed tool cannot reach the platform's data or
 * event bus. Network isolation is NOT enforced on this host (Windows has no
 * per-process network namespaces) — documented honestly; process/memory/
 * time isolation is the v1 contract.
 *
 * OPT-IN, OPERATOR-CONTROLLED (least privilege by default — no SDK contract
 * change): PLUGIN_SANDBOX_MODE=off|process (default off) + the plugin list
 * PLUGIN_SANDBOX_PLUGINS=<id,id>|* (default: none). With mode off (the
 * default) the platform behaves exactly as before — in-process invokes.
 */
@Injectable()
export class PluginSandboxService {
  private readonly logger = new Logger(PluginSandboxService.name);
  private readonly mode: "off" | "process";
  private readonly plugins: string[];
  private readonly timeoutMs: number;
  private readonly memoryMb: number;
  private readonly maxResultBytes: number;
  private readonly runnerPath: string;
  private spawnImpl: typeof spawn = spawn;

  constructor(private readonly config: ConfigService) {
    this.mode = config.get<"off" | "process">("PLUGIN_SANDBOX_MODE", "off") === "process" ? "process" : "off";
    this.plugins = (config.get<string>("PLUGIN_SANDBOX_PLUGINS", "") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    this.timeoutMs = Number(config.get("PLUGIN_SANDBOX_TIMEOUT_MS", "30000"));
    this.memoryMb = Number(config.get("PLUGIN_SANDBOX_MEMORY_MB", "256"));
    this.maxResultBytes = Number(config.get("PLUGIN_SANDBOX_MAX_RESULT_BYTES", "1000000"));
    this.runnerPath = resolveSandboxRunner();
    this.spawnImpl = sandboxSpawnOverride ?? spawn;
    if (this.mode === "process") {
      this.logger.log(
        `Plugin sandbox ENABLED (process mode) — plugins: [${this.plugins.join(", ") || "none"}] · timeout ${this.timeoutMs}ms · heap ${this.memoryMb}MB`,
      );
    }
  }

  /** Whether invocations of `pluginId` must run in the sandbox. */
  shouldSandbox(pluginId: string): boolean {
    if (this.mode !== "process") return false;
    return this.plugins.includes("*") || this.plugins.includes(pluginId);
  }

  /**
   * Run one tool invocation in a child process. Returns the plugin's ToolResult
   * (passed through byte-for-byte from the runner), or an honest `ok:false`
   * envelope for every failure class: spawn error, wall-clock timeout, V8 OOM
   * (--max-old-space-size), crash (non-zero exit), result-size overflow, and
   * malformed output. NEVER logs args.
   */
  async dispatch(plugin: LoadedPlugin, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const pluginId = plugin.manifest.id;
    const job = {
      entry: resolve(join(plugin.dir, plugin.manifest.entry)),
      pluginId,
      tool: toolName,
      args,
      settings: plugin.manifest.settings ?? [],
    };

    const dir = mkdtempSync(join(tmpdir(), "cst-sandbox-"));
    const jobFile = join(dir, "job.json");
    let child: ReturnType<typeof spawn> | undefined;
    try {
      writeFileSync(jobFile, JSON.stringify(job));
      child = this.spawnImpl(
        process.execPath,
        [`--max-old-space-size=${this.memoryMb}`, this.runnerPath, jobFile],
        { stdio: ["ignore", "pipe", "pipe"], env: process.env },
      );

      const outcome = await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolvePromise) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            child?.kill("SIGKILL");
          } catch {
            /* already gone */
          }
          resolvePromise({ exitCode: null, stdout, stderr: `${stderr}\n[sandbox] killed by timeout after ${this.timeoutMs}ms` });
        }, this.timeoutMs);

        child!.stdout!.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
          if (stdout.length > this.maxResultBytes) {
            // Result-size overflow: kill immediately, never buffer unbounded.
            if (!settled) {
              settled = true;
              try {
                child?.kill("SIGKILL");
              } catch {
                /* already gone */
              }
              resolvePromise({
                exitCode: null,
                stdout,
                stderr: `${stderr}\n[sandbox] result exceeded ${this.maxResultBytes} bytes`,
              });
            }
          }
        });
        child!.stderr!.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
          if (stderr.length > 64 * 1024) stderr = stderr.slice(-64 * 1024);
        });
        child!.on("error", (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolvePromise({ exitCode: null, stdout, stderr: `${stderr}\n[sandbox] spawn error: ${err.message}` });
        });
        child!.on("close", (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolvePromise({ exitCode: code, stdout, stderr });
        });
      });

      // The runner always writes ONE JSON line and exits 0 on success; a
      // non-zero exit (or a killed child) is a crash/timeout/OOM — an honest
      // failure, never a 500 and never a wedged request.
      const lastLine = outcome.stdout.split(/\r?\n/).filter(Boolean).pop();
      if (outcome.exitCode === 0 && lastLine) {
        try {
          const result = JSON.parse(lastLine) as ToolResult;
          if (result && typeof result.ok === "boolean") return result;
        } catch {
          /* fall through to the crash envelope */
        }
      }
      return {
        ok: false,
        error: `Sandboxed plugin "${pluginId}" tool "${toolName}" failed (exit ${outcome.exitCode ?? "killed"}): ${outcome.stderr.trim().slice(-400) || "no diagnostic output"}`,
      };
    } finally {
      if (child && child.exitCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** Test seam — swap the process spawner (unit tests never spawn real node). */
export function __setSandboxSpawnForTests(fn: typeof spawn | undefined): void {
  sandboxSpawnOverride = fn;
}

let sandboxSpawnOverride: typeof spawn | undefined;

/**
 * Resolve the runner script. The api boots from `apps/api` (node dist/main.js)
 * or the repo root, so try the relative spots and take the first that exists;
 * `PLUGIN_SANDBOX_RUNNER` overrides everything (custom layouts). FOUND LIVE
 * (2026-08-04): a naive `resolve(cwd, "../../scripts/…")`-then-endsWith check
 * picked a NON-EXISTENT path (apps/api/scripts/…) and every sandboxed child
 * died with `CJSWithHooks … MODULE_NOT_FOUND` — containment held (honest
 * ok:false, api survived) but no tool ever ran.
 */
function resolveSandboxRunner(): string {
  const override = process.env.PLUGIN_SANDBOX_RUNNER;
  if (override) return resolve(override);
  const candidates = [
    resolve(process.cwd(), "../../scripts/plugin-sandbox-runner.mjs"),
    resolve(process.cwd(), "scripts/plugin-sandbox-runner.mjs"),
    resolve(process.cwd(), "../scripts/plugin-sandbox-runner.mjs"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}
