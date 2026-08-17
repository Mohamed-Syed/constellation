import { Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator.js";
import { AlertWebhookService, type IngestedAlert } from "./alert-webhook.service.js";

/**
 * Grafana/Prometheus ALERT-TRIGGER INGESTION (Phase 4.0 4.5 tail).
 *
 * Alertmanager webhook receiver: POST /api/alerts/webhook with the standard
 * Alertmanager payload. Auth is a SHARED SECRET header (`X-Webhook-Secret`)
 * matching env `ALERT_WEBHOOK_SECRET` — Prometheus/Grafana can't do JWTs, so
 * the static secret is the honest pattern; when the env is UNSET the endpoint
 * accepts in dev mode (logged). Each alert becomes an `engine.alert.fired`
 * bus event → event-triggered workflows (the incident-response primitive)
 * remediate automatically.
 */
@ApiTags("alerts")
@Controller("alerts")
export class AlertsController {
  constructor(private readonly alerts: AlertWebhookService) {}

  @Public()
  @Post("webhook")
  @ApiOkResponse({ description: "Ingested alerts (also emitted as engine.alert.fired)." })
  async webhook(
    @Headers("x-webhook-secret") secret: string | undefined,
    @Body() body: unknown,
  ): Promise<{ ok: boolean; ingested: IngestedAlert[] }> {
    const expected = process.env.ALERT_WEBHOOK_SECRET;
    if (expected && secret !== expected) {
      throw new UnauthorizedException("Invalid webhook secret.");
    }
    const ingested = await this.alerts.ingest(body);
    return { ok: true, ingested };
  }
}
