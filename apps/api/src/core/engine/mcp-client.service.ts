import { Injectable, Logger } from "@nestjs/common";

export interface McpToolDef {
  /** Server alias (from MCP_CLIENT_URLS) this tool came from. */
  server: string;
  /** Tool name on the remote server. */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpClientResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

const TOOLS_CACHE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * MCP CLIENT side (Phase 4.0 4.3 tail) — the agent plane can CALL external
 * MCP servers as tools.
 *
 * `MCP_CLIENT_URLS` env: comma-separated `alias=http://host:port/mcp` entries.
 * Each server's `tools/list` is discovered at worker-prompt build time (cached
 * 30s) and surfaced to the agent as `plugin="mcp" tool="<alias>.<toolName>"`;
 * `call` proxies the agent's arguments through JSON-RPC `tools/call` and
 * returns the content text. Unreachable servers degrade to "no tools from
 * this server" (the rest of the platform is unaffected).
 */
@Injectable()
export class McpClientService {
  private readonly logger = new Logger(McpClientService.name);
  private readonly servers: Array<{ alias: string; url: string }> = [];
  private readonly headers: Record<string, string> = {};
  private cache: { at: number; tools: McpToolDef[] } | null = null;

  constructor() {
    const raw = process.env.MCP_CLIENT_URLS?.trim();
    if (raw) {
      for (const entry of raw.split(",")) {
        const part = entry.trim();
        if (!part) continue;
        const eq = part.indexOf("=");
        if (eq > 0) {
          this.servers.push({ alias: part.slice(0, eq).trim(), url: part.slice(eq + 1).trim() });
        } else {
          this.servers.push({ alias: part.replace(/^https?:\/\//, "").split(/[/:.]/)[0] || "mcp", url: part });
        }
      }
    }
    const headerRaw = process.env.MCP_CLIENT_HEADERS?.trim();
    if (headerRaw) {
      try {
        const parsed = JSON.parse(headerRaw) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") this.headers[k] = v;
        }
      } catch {
        this.logger.warn("MCP_CLIENT_HEADERS is not valid JSON — ignoring.");
      }
    }
    if (this.servers.length > 0) {
      this.logger.log(`MCP client: ${this.servers.length} external server(s) configured (${this.servers.map((s) => s.alias).join(", ")}).`);
    }
  }

  /** All discovered tools across all configured servers (cached 30s). */
  async tools(): Promise<McpToolDef[]> {
    if (this.servers.length === 0) return [];
    if (this.cache && Date.now() - this.cache.at < TOOLS_CACHE_MS) return this.cache.tools;
    const out: McpToolDef[] = [];
    for (const server of this.servers) {
      const defs = await this.listServerTools(server.alias, server.url);
      out.push(...defs);
    }
    this.cache = { at: Date.now(), tools: out };
    return out;
  }

  /** The `plugin="mcp" tool="alias.name"` lines for the agent's system prompt. */
  async promptLines(): Promise<string[]> {
    const tools = await this.tools();
    return tools.map((t) => `  - plugin="mcp" tool="${t.server}.${t.name}": ${t.description || "external MCP tool"}`);
  }

  /** Invoke an external MCP tool: `tool` must be `alias.name`. */
  async call(tool: string, args: Record<string, unknown>): Promise<McpClientResult> {
    const dot = tool.indexOf(".");
    if (dot <= 0) return { ok: false, error: `Malformed MCP tool "${tool}" — expected alias.name` };
    const alias = tool.slice(0, dot);
    const name = tool.slice(dot + 1);
    const server = this.servers.find((s) => s.alias === alias);
    if (!server) return { ok: false, error: `Unknown MCP server alias "${alias}"` };

    const res = await this.rpc(server.url, "tools/call", { name, arguments: args ?? {} });
    if (!res.ok) return res;
    const body = res.body as Record<string, unknown>;
    const result = body.result as Record<string, unknown> | undefined;
    if (result?.isError) {
      const text = extractText(result.content);
      return { ok: false, error: text ?? "MCP tool reported an error" };
    }
    const text = extractText(result?.content);
    return { ok: true, result: text ?? result ?? null };
  }

  private async listServerTools(alias: string, url: string): Promise<McpToolDef[]> {
    try {
      const init = await this.rpc(url, "initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "constellation-mcp-client", version: "0.1.0" },
      });
      if (!init.ok) {
        this.logger.warn(`MCP client: initialize failed for ${alias} — ${init.error ?? "no response"}`);
        return [];
      }
      const listed = await this.rpc(url, "tools/list", {});
      if (!listed.ok) {
        this.logger.warn(`MCP client: tools/list failed for ${alias} — ${listed.error ?? "no response"}`);
        return [];
      }
      const result = listed.body?.result as Record<string, unknown> | undefined;
      const tools = Array.isArray(result?.tools) ? (result.tools as Array<Record<string, unknown>>) : [];
      return tools
        .filter((t) => typeof t.name === "string")
        .map((t) => ({
          server: alias,
          name: String(t.name),
          description: typeof t.description === "string" ? t.description : "",
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
        }));
    } catch (err) {
      this.logger.warn(`MCP client: server ${alias} unreachable — ${asMessage(err)}`);
      return [];
    }
  }

  private async rpc(
    url: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ ok: boolean; body?: Record<string, unknown>; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal,
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const body = (await res.json()) as Record<string, unknown>;
      if (body.error) return { ok: false, error: String((body.error as Record<string, unknown>)?.message ?? "JSON-RPC error") };
      return { ok: true, body };
    } catch (err) {
      return { ok: false, error: asMessage(err) };
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const item of content) {
    const c = item as Record<string, unknown>;
    if (typeof c.text === "string") parts.push(c.text);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
