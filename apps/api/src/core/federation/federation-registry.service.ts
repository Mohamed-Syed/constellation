import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { parseSimpleYaml, type YamlValue } from "./simple-yaml.js";

/** A federated tool as exposed to the portal. */
export interface FederatedModule {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  /** Public path on the portal origin, via the reverse proxy. */
  path: string;
  /** Safe to render inside an iframe tile. */
  embeddable: boolean;
  /** Expected to share the platform's OIDC session. */
  sso: boolean;
  /** `tile` = advertise in the UI; `hidden` = proxied but not shown. */
  display: "tile" | "hidden";
  enabled: boolean;
  requiresPermissions: string[];
  /**
   * Internal upstream address. NOT sent to browsers — it's compose-network
   * only and would leak topology. Stripped by the controller.
   */
  upstream: string;
  healthPath: string;
}

const DEFAULT_REGISTRY_PATH = "config/modules.yaml";

/**
 * Loads the declarative federation registry (`config/modules.yaml`) — the
 * P3 "portal federation" catalogue of heavyweight tools the platform proxies
 * rather than reimplements (C5/C7).
 *
 * Follows the platform-wide degrade-never-throw rule: a missing, unreadable,
 * or malformed registry logs a warning and yields an EMPTY list. The API and
 * portal keep working with zero federated tiles — a broken config file must
 * never stop the platform booting.
 */
@Injectable()
export class FederationRegistryService implements OnModuleInit {
  private readonly logger = new Logger(FederationRegistryService.name);
  private modules: FederatedModule[] = [];
  private loadError: string | undefined;

  onModuleInit(): void {
    this.reload();
  }

  /** (Re)read the registry from disk. Safe to call at runtime. */
  reload(): void {
    const path = this.registryPath();
    this.loadError = undefined;

    if (!existsSync(path)) {
      this.logger.warn(`No federation registry at ${path} — zero federated modules.`);
      this.modules = [];
      return;
    }

    try {
      const parsed = parseSimpleYaml(readFileSync(path, "utf8"));
      this.modules = this.normalize(parsed);
      const shown = this.modules.filter((m) => m.enabled && m.display === "tile").length;
      this.logger.log(
        `Loaded ${this.modules.length} federated module(s) from ${path} (${shown} visible tile(s)).`,
      );
    } catch (err) {
      this.loadError = asMessage(err);
      this.modules = [];
      this.logger.warn(`Failed to parse ${path} — continuing with zero federated modules: ${this.loadError}`);
    }
  }

  /** Every registered module, including hidden/disabled ones. */
  all(): FederatedModule[] {
    return [...this.modules];
  }

  /** Enabled modules only — what the portal should consider live. */
  enabled(): FederatedModule[] {
    return this.modules.filter((m) => m.enabled);
  }

  findById(id: string): FederatedModule | undefined {
    return this.modules.find((m) => m.id === id);
  }

  /** Diagnostics for `/api/health` and the admin page. */
  status(): { total: number; enabled: number; tiles: number; error?: string } {
    const enabled = this.modules.filter((m) => m.enabled);
    return {
      total: this.modules.length,
      enabled: enabled.length,
      tiles: enabled.filter((m) => m.display === "tile").length,
      ...(this.loadError ? { error: this.loadError } : {}),
    };
  }

  private registryPath(): string {
    const configured = process.env.FEDERATION_REGISTRY_PATH?.trim();
    if (configured) return resolve(configured);
    // dist/main.js runs from apps/api, so the repo root is two levels up;
    // fall back to cwd-relative for a dev/test run from elsewhere.
    const fromRepoRoot = resolve(process.cwd(), "..", "..", DEFAULT_REGISTRY_PATH);
    if (existsSync(fromRepoRoot)) return fromRepoRoot;
    return resolve(process.cwd(), DEFAULT_REGISTRY_PATH);
  }

  private normalize(parsed: YamlValue): FederatedModule[] {
    if (!isRecord(parsed)) throw new Error("registry root must be a mapping");

    const defaults = isRecord(parsed.defaults) ? parsed.defaults : {};
    const raw = parsed.modules;
    if (raw === null || raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error('"modules" must be a sequence');

    const seen = new Set<string>();
    const out: FederatedModule[] = [];

    for (const entry of raw) {
      if (!isRecord(entry)) {
        this.logger.warn("Skipping a non-mapping entry in modules.");
        continue;
      }
      const id = str(entry.id);
      if (!id) {
        this.logger.warn("Skipping a module with no id.");
        continue;
      }
      if (seen.has(id)) {
        this.logger.warn(`Skipping duplicate module id "${id}".`);
        continue;
      }
      seen.add(id);

      const proxy = isRecord(entry.proxy) ? entry.proxy : {};
      const path = str(proxy.path) || `/tools/${id}`;
      if (!path.startsWith("/")) {
        this.logger.warn(`Module "${id}" has a non-absolute proxy path "${path}" — skipping.`);
        continue;
      }

      out.push({
        id,
        name: str(entry.name) || id,
        description: str(entry.description),
        category: str(entry.category) || "general",
        icon: str(entry.icon) || "box",
        path,
        embeddable: bool(proxy.embeddable, false),
        sso: bool(entry.sso, bool(defaults.sso, false)),
        display: resolveDisplay(entry.display, defaults.display),
        enabled: bool(entry.enabled, bool(defaults.enabled, true)),
        requiresPermissions: strArray(entry.requiresPermissions),
        upstream: str(entry.upstream),
        healthPath: str(entry.healthPath) || "/",
      });
    }

    return out;
  }
}

function isRecord(v: unknown): v is Record<string, YamlValue> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Per-module `display` wins; else the file default; else "tile". */
function resolveDisplay(own: unknown, fallback: unknown): "tile" | "hidden" {
  const value = str(own) || str(fallback);
  return value === "hidden" ? "hidden" : "tile";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
