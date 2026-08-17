import { Injectable, Logger, Optional } from "@nestjs/common";
import { join } from "node:path";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { ConfigService } from "@nestjs/config";
import { AuditService, type AuditEntry } from "../audit/audit.service.js";
import { auditToPdf } from "../audit/pdf-export.js";
import { NotificationService } from "../notifications/notification.service.js";
import { NotificationChannelService } from "../notifications/notification-channel.service.js";

/** Default directory reports are written to (artifacts/reports under the repo root). */
export const DEFAULT_REPORT_DIR = "artifacts/reports";

export interface GeneratedReport {
  path: string;
  filename: string;
  bytes: number;
  rows: number;
  from: string;
  to: string;
  generatedAt: string;
}

export interface ReportOptions {
  /** Override the output directory (test seam / deployment setting). */
  reportDir?: string;
  /** Cap on how many audit rows a report carries. */
  maxRows?: number;
}

export const REPORT_OPTIONS = Symbol("REPORT_OPTIONS");

/**
 * Phase 4.0 backlog #2 — SCHEDULED REPORT DELIVERY.
 *
 * Generates a compliance/audit PDF and delivers it: a durable notification in
 * the feed + a channel dispatch through the configured webhooks (Slack/Discord/
 * Teams/generic). The report bytes are written to `artifacts/reports/` so they
 * are retrievable/attachable; the notification + channel message carry the file
 * path and a row/bytes summary.
 *
 * Trigger today is the REST surface (`POST /api/reports`) — an operator or cron
 * can call it; the report is generated from the CURRENT audit log, so a cron
 * hitting it daily/weekly is the "scheduled delivery" behaviour. A dedicated
 * `kind:"report"` schedule is the documented follow-up on top of this service.
 *
 * No-DB / no-audit degrades honestly: an empty report is still a valid PDF.
 */
@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);
  private readonly reportDir: string;
  private readonly maxRows: number;

  constructor(
    private readonly audit: AuditService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly channels?: NotificationChannelService,
    @Optional() config?: ConfigService,
    @Optional() options?: ReportOptions,
  ) {
    this.reportDir =
      options?.reportDir ?? config?.get<string>("REPORT_DIR") ?? join(process.cwd(), DEFAULT_REPORT_DIR);
    this.maxRows = options?.maxRows ?? 500;
  }

  /**
   * Generate a fresh audit report now.
   * @param opts actor/action substring filters + optional custom title.
   */
  async generate(
    opts: { actor?: string; action?: string; title?: string; deliver?: boolean; recipientId?: string | null } = {},
  ): Promise<GeneratedReport> {
    const entries = await this.audit.listForExport({ limit: this.maxRows, actor: opts.actor, action: opts.action });
    const from = expiryLocale(entries[0]?.createdAt);
    const to = expiryLocale(entries[entries.length - 1]?.createdAt);
    const title = opts.title ?? "Constellation compliance report";
    const pdf = auditToPdf(entries, title);

    await mkdir(this.reportDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `audit-report-${stamp}.pdf`;
    const path = join(this.reportDir, filename);
    await writeFile(path, pdf);

    const report: GeneratedReport = {
      path,
      filename,
      bytes: pdf.length,
      rows: entries.length,
      from,
      to,
      generatedAt: new Date().toISOString(),
    };

    if (opts.deliver) {
      await this.deliver(report, title, opts.recipientId ?? null);
    }

    this.logger.log(`Generated audit report: ${path} (${report.bytes} bytes, ${report.rows} rows)`);
    return report;
  }

  /**
   * Persist a durable notification + dispatch a channel event announcing the
   * report. Fire-and-forget: a failed channel never breaks report generation.
   */
  async deliver(report: GeneratedReport, title = "Constellation compliance report", recipientId: string | null = null): Promise<void> {
    const message = `Generated ${title}: ${report.rows} audit row(s), ${report.bytes} bytes -> ${report.path}`;
    // BG4 per-user targeting: when a recipientId is given, the durable
    // notification is visible ONLY to that user (global otherwise).
    await this.notifications?.record("report.generated", "info", title, message, "report", report.filename, recipientId);
    try {
      await this.channels?.dispatch("report.generated", {
        title,
        message,
        severity: "info",
        kind: "report.generated",
        refType: "report",
        refId: report.filename,
      });
    } catch (err) {
      this.logger.warn(`Report channel dispatch failed (non-fatal): ${asMessage(err)}`);
    }
  }

  /** List previously generated reports (filenames + sizes, newest first). */
  async list(limit = 20): Promise<Array<{ filename: string; path: string; bytes: number }>> {
    try {
      const files = (await readdir(this.reportDir)).filter((f) => f.endsWith(".pdf")).sort().reverse();
      const out: Array<{ filename: string; path: string; bytes: number }> = [];
      for (const filename of files.slice(0, Math.max(1, Math.min(limit, 100)))) {
        out.push({ filename, path: join(this.reportDir, filename), bytes: 0 });
      }
      return out;
    } catch {
      return [];
    }
  }
}

function expiryLocale(d: Date | undefined): string {
  return d ? new Date(d).toISOString() : "—";
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
