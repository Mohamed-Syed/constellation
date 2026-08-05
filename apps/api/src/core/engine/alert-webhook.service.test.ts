import { describe, expect, it, vi } from "vitest";
import { AlertWebhookService, type IngestedAlert } from "./alert-webhook.service.js";

function fakeBus() {
  const emitted: Array<{ topic: string; payload: unknown }> = [];
  return {
    emitted,
    bus: {
      forPlugin: () => ({
        emit: (topic: string, payload: unknown) => {
          emitted.push({ topic, payload });
        },
      }),
    } as never,
  };
}

const ALERTMANAGER_PAYLOAD = {
  status: "firing",
  groupKey: "group-1",
  alerts: [
    {
      status: "firing",
      labels: { alertname: "HighCPU", severity: "critical", instance: "node-1" },
      annotations: { summary: "CPU above 90% for 10m" },
      startsAt: "2026-08-05T12:00:00Z",
    },
    {
      status: "resolved",
      labels: { alertname: "DiskFull", severity: "warning", job: "prometheus" },
      annotations: { description: "disk at 95%" },
      startsAt: "2026-08-05T11:00:00Z",
    },
  ],
};

describe("AlertWebhookService — Prometheus/Grafana alert ingestion (4.5 tail)", () => {
  it("normalizes an Alertmanager payload and emits engine.alert.fired per alert", async () => {
    const { bus, emitted } = fakeBus();
    const audit = { record: vi.fn(async () => undefined) } as never;
    const svc = new AlertWebhookService(audit, bus);
    const ingested = await svc.ingest(ALERTMANAGER_PAYLOAD);
    expect(ingested).toHaveLength(2);
    expect(ingested[0]).toMatchObject({
      alertname: "HighCPU",
      status: "firing",
      severity: "critical",
      instance: "node-1",
      summary: "CPU above 90% for 10m",
    });
    expect(ingested[1]?.instance).toBe("prometheus"); // job fallback
    expect(emitted.map((e) => e.topic)).toEqual(["engine.alert.fired", "engine.alert.fired"]);
    expect((emitted[0]?.payload as IngestedAlert).alertname).toBe("HighCPU");
    expect(audit.record).toHaveBeenCalledWith(null, "alert.ingested", "alerts:2", expect.objectContaining({ groupKey: "group-1" }));
  });

  it("ingest of an empty payload returns [] and emits nothing", async () => {
    const { bus, emitted } = fakeBus();
    const svc = new AlertWebhookService(undefined, bus);
    expect(await svc.ingest({})).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it("never throws when the bus misbehaves", async () => {
    const badBus = {
      forPlugin: () => ({
        emit: () => {
          throw new Error("bus down");
        },
      }),
    } as never;
    const svc = new AlertWebhookService(undefined, badBus);
    const ingested = await svc.ingest(ALERTMANAGER_PAYLOAD);
    expect(ingested).toHaveLength(2); // ingestion still reports the alerts
  });
});
