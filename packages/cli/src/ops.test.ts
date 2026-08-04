import { describe, expect, it, vi, afterEach } from "vitest";
import { Command } from "commander";
import { apiJson, pick, printTable, registerOps } from "./ops.js";

afterEach(() => {
  vi.restoreAllMocks();
  // Delete env so it doesn't leak across tests.
  delete process.env.CONSTELLATION_URL;
  delete process.env.CONSTELLATION_TOKEN;
});

describe("registerOps", () => {
  it("registers an `ops` parent with the six expected subcommands", () => {
    const program = new Command();
    registerOps(program);
    const ops = program.commands.find((c) => c.name() === "ops");
    expect(ops).toBeDefined();
    expect(ops!.commands.some((c) => c.name() === "health")).toBe(true);
    expect(ops!.commands.some((c) => c.name() === "tasks")).toBe(true);
    expect(ops!.commands.some((c) => c.name() === "schedules")).toBe(true);
    expect(ops!.commands.some((c) => c.name() === "deadletters")).toBe(true);
    expect(ops!.commands.some((c) => c.name() === "plugins")).toBe(true);
    // `engine` is a parent command with a `status` subcommand.
    const engine = ops!.commands.find((c) => c.name() === "engine");
    expect(engine?.commands.map((c) => c.name())).toContain("status");
  });
});

describe("apiJson", () => {
  it("returns parsed JSON and http status", async () => {
    global.fetch = vi.fn(async () => ({
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    })) as unknown as typeof fetch;
    const res = await apiJson("http://x", "tok", "/health");
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(global.fetch).toHaveBeenCalledWith("http://x/health", {
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("falls back to a string body for non-JSON responses", async () => {
    global.fetch = vi.fn(async () => ({
      status: 200,
      text: async () => "plain text",
    })) as unknown as typeof fetch;
    const res = await apiJson("http://x", undefined, "/x");
    expect(res.body).toBe("plain text");
  });

  it("does not attach an Authorization header when no token", async () => {
    global.fetch = vi.fn(async () => ({
      status: 200,
      text: async () => "{}",
    })) as unknown as typeof fetch;
    await apiJson("http://x", undefined, "/x");
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("http://x/x");
    // Empty headers object is passed; crucially there is NO Authorization key.
    expect((init as RequestInit).headers).toEqual({});
  });
});

describe("pick", () => {
  it("projects only the requested keys, defaulting missing to empty string", () => {
    expect(
      pick({ id: "t1", title: "Hello", status: "running", stepCount: 3, createdAt: "x" }, [
        "id",
        "title",
        "status",
        "missing",
      ]),
    ).toEqual({ id: "t1", title: "Hello", status: "running", missing: "" });
  });
});

describe("printTable", () => {
  it("prints (none) for empty rows", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    printTable([]);
    expect(log).toHaveBeenCalledWith("(none)");
  });

  it("prints a header and each row", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    printTable([{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }]);
    const calls = log.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => String(c).includes("id"))).toBe(true);
    expect(calls.some((c) => String(c).includes("Alpha"))).toBe(true);
    expect(calls.some((c) => String(c).includes("Beta"))).toBe(true);
  });
});
