import { describe, expect, it } from "vitest";
import { renderTemplates, validateWorkflowDefinition } from "./workflow.schema.js";

describe("validateWorkflowDefinition", () => {
  it("accepts a valid manual workflow with agent + tool steps", () => {
    expect(
      validateWorkflowDefinition({
        trigger: { type: "manual" },
        steps: [
          { id: "s1", kind: "agent", prompt: "Do the thing" },
          { id: "s2", kind: "tool", plugin: "graphify", tool: "graph.query", args: { question: "hi" } },
        ],
      }),
    ).toBeNull();
  });

  it("requires a trigger", () => {
    expect(validateWorkflowDefinition({ steps: [] })).toContain("trigger");
  });

  it("requires cron for cron triggers", () => {
    expect(validateWorkflowDefinition({ trigger: { type: "cron" }, steps: [{ id: "s1", kind: "agent", prompt: "x" }] }))
      .toContain("cron");
  });

  it("rejects an empty steps array", () => {
    expect(validateWorkflowDefinition({ trigger: { type: "manual" }, steps: [] })).toContain("non-empty");
  });

  it("rejects duplicate step ids", () => {
    expect(
      validateWorkflowDefinition({
        trigger: { type: "manual" },
        steps: [
          { id: "s1", kind: "agent", prompt: "a" },
          { id: "s1", kind: "agent", prompt: "b" },
        ],
      }),
    ).toContain("duplicate");
  });

  it("rejects agent steps without a prompt", () => {
    expect(
      validateWorkflowDefinition({ trigger: { type: "manual" }, steps: [{ id: "s1", kind: "agent" }] }),
    ).toContain("prompt");
  });

  it("rejects tool steps without a plugin or tool", () => {
    expect(
      validateWorkflowDefinition({ trigger: { type: "manual" }, steps: [{ id: "s1", kind: "tool", plugin: "p" }] }),
    ).toContain("tool name");
  });

  it("rejects an unknown step kind", () => {
    expect(
      validateWorkflowDefinition({ trigger: { type: "manual" }, steps: [{ id: "s1", kind: "magic" }] }),
    ).toContain("agent");
  });

  it("rejects non-object definitions", () => {
    expect(validateWorkflowDefinition("nope")).toContain("object");
  });
});

describe("renderTemplates", () => {
  it("replaces result + error placeholders from earlier steps", () => {
    const outcomes = new Map([
      ["s1", { ok: true, result: { summary: "hello" } }],
      ["s2", { ok: false, result: null, error: "boom" }],
    ]);
    expect(
      renderTemplates("{{steps.s1.result}} then {{steps.s2.error}}", outcomes),
    ).toBe('{"summary":"hello"} then boom');
  });

  it("leaves unknown references as-is", () => {
    expect(renderTemplates("{{steps.nope.result}}", new Map())).toBe("{{steps.nope.result}}");
  });

  it("renders string results verbatim", () => {
    const outcomes = new Map([["s1", { ok: true, result: "plain text" }]]);
    expect(renderTemplates("got: {{steps.s1.result}}", outcomes)).toBe("got: plain text");
  });
});
