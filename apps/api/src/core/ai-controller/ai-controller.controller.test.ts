import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CorePermissions } from "@constellation/plugin-sdk";
import { REQUIRED_PERMISSIONS_KEY } from "../rbac/require-permissions.decorator.js";
import { AiController } from "./ai-controller.controller.js";
import type { ControllerService } from "./controller.service.js";

/**
 * Controller-level tests: the RBAC metadata each route declares (this is the
 * security contract of the round — POST /act runs recovery mutations, so a
 * missing decorator or a read-permission slip is a silent authz hole that a
 * behavioural test would never catch) plus the act() response/audit mapping.
 *
 * NOTE: empty/whitespace `action` bodies are rejected by the GLOBAL
 * ValidationPipe (main.ts, `whitelist + forbidNonWhitelisted` against the
 * class-validator ActDto) — that is standard NestJS plumbing, not unit-tested
 * here.
 */

function requiredPermissions(method: keyof AiController): string[] | undefined {
  return Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AiController.prototype[method] as object);
}

function makeController(overrides: { act?: ReturnType<typeof vi.fn>; record?: ReturnType<typeof vi.fn> } = {}) {
  const controller = {
    act: overrides.act ?? vi.fn(async () => ({ ok: true, ran: true, message: "done" })),
  } as unknown as ControllerService;
  const notifications = {
    record: overrides.record ?? vi.fn(async () => undefined),
  } as never;
  // Constructor order: (controller, mesh, tasks, queue, scheduler, supervisor, notifications, plugins)
  const ctrl = new AiController(controller, undefined as never, undefined as never, undefined as never, undefined as never, undefined as never, notifications, undefined as never);
  return { ctrl, controller, notifications: notifications as { record: ReturnType<typeof vi.fn> } };
}

describe("AiController — RBAC contract (Phase 5.0)", () => {
  it("GET /status requires core:audit:read (read surface)", () => {
    expect(requiredPermissions("status")).toEqual([CorePermissions.AUDIT_READ]);
  });

  it("GET /actions requires core:audit:read (read surface)", () => {
    expect(requiredPermissions("actions")).toEqual([CorePermissions.AUDIT_READ]);
  });

  it("POST /act requires the DEDICATED core:ai-controller:manage — never a bare read permission", () => {
    expect(requiredPermissions("act")).toEqual([CorePermissions.AI_CONTROLLER_MANAGE]);
    expect(CorePermissions.AI_CONTROLLER_MANAGE).toBe("core:ai-controller:manage");
  });
});

describe("AiController — act() mapping", () => {
  it("trims the action and forwards it to the service", async () => {
    const { ctrl, controller } = makeController();
    await ctrl.act({ action: "  reprobe-mesh  " } as never);
    expect(controller.act).toHaveBeenCalledWith("reprobe-mesh");
  });

  it("maps an ok:false service result to HTTP 400 with the precise message", async () => {
    const act = vi.fn(async () => ({ ok: false, ran: false, message: "No safe controller action 'nuke'. Available: reprobe-mesh." }));
    const { ctrl, notifications } = makeController({ act });
    await expect(ctrl.act({ action: "nuke" } as never)).rejects.toThrow(BadRequestException);
    await expect(ctrl.act({ action: "nuke" } as never)).rejects.toThrow("No safe controller action 'nuke'");
    // Rejected actions are NOT audited as 'acted'.
    expect(notifications.record).not.toHaveBeenCalled();
  });

  it("audits ONLY actions that actually ran", async () => {
    const act = vi.fn(async () => ({ ok: true, ran: false, message: "Supervisor sweep skipped." }));
    const { ctrl, notifications } = makeController({ act });
    await ctrl.act({ action: "flush-stale" } as never);
    expect(notifications.record).not.toHaveBeenCalled();

    act.mockResolvedValue({ ok: true, ran: true, message: "Re-probed all mesh peers." });
    await ctrl.act({ action: "reprobe-mesh" } as never);
    expect(notifications.record).toHaveBeenCalledWith(
      "ai-controller.acted",
      "info",
      "AI Controller acted",
      "Re-probed all mesh peers.",
      "ai-controller",
      "reprobe-mesh",
    );
  });
});
