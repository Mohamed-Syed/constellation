import { describe, expect, it } from "vitest";
import { asMessage, deepestCauseMessage } from "./error-utils.js";

describe("error-utils (Phase 4.0 CQ — shared asMessage / deepestCauseMessage)", () => {
  it("asMessage flattens an Error to its message and a non-Error to a string", () => {
    expect(asMessage(new Error("boom"))).toBe("boom");
    expect(asMessage("raw")).toBe("raw");
    expect(asMessage(42)).toBe("42");
    expect(asMessage(null)).toBe("null");
  });

  it("deepestCauseMessage walks to the deepest nested cause", () => {
    const outer = new Error("fetch failed", { cause: new Error("ECONNREFUSED", { cause: new Error("127.0.0.1:4999") }) });
    expect(deepestCauseMessage(outer)).toBe("127.0.0.1:4999");
  });

  it("deepestCauseMessage stays sane for a plain Error and a non-Error", () => {
    expect(deepestCauseMessage(new Error("plain"))).toBe("plain");
    expect(deepestCauseMessage("text")).toBe("text");
    expect(deepestCauseMessage(null)).toBe("null");
  });
});
