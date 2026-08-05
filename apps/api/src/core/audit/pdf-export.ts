import type { AuditEntry } from "./audit.service.js";

/**
 * Compliance reports tail (Phase 4.0 4.7): a ZERO-DEPENDENCY PDF writer for the
 * audit export. Produces a minimal but fully valid single-page (multi-page when
 * needed) PDF with a header + the audit table, using Helvetica + WinAnsi text.
 *
 * The PDF format is deliberately hand-rolled (object graph + xref + trailer):
 * adding a dependency (pdfkit/pdf-lib) for one table would double the api's
 * footprint for a report that is evidence, not typesetting. Rows beyond the
 * page capacity flow onto additional pages. Text is sanitized (WinAnsi-safe,
 * backslash/paren escaped) so hostile log content cannot break the file.
 */

const PAGE_W = 595.28; // A4 portrait points
const PAGE_H = 841.89;
const MARGIN = 48;
const ROW_H = 16;
const LINE_H = 12;

interface PdfObject {
  id: number;
  body: string;
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\x00-\x1f\x7f-\xff]/g, (ch) => `\\${ch.charCodeAt(0).toString(8).padStart(3, "0")}`);
}

function sanitize(s: string): string {
  // WinAnsi-ish: strip control chars + anything outside printable ASCII/ISO-8859-1
  return s.replace(/[^\x20-\x7e\xa0-\xff]/g, "").replace(/\s+/g, " ").trim();
}

/** Build the PDF. `title` is the report heading, `entries` the audit rows. */
export function auditToPdf(entries: AuditEntry[], title = "Constellation — Audit log export"): Buffer {
  const contentLen = (s: string): number => Buffer.byteLength(s, "latin1");
  const objects: PdfObject[] = [];
  const nextId = (body: string): number => {
    objects.push({ id: objects.length + 1, body });
    return objects.length;
  };

  // Build page content streams from the rows.
  const pages: Array<{ id: number; content: string }> = [];
  const chunksPerPage = Math.max(1, Math.floor((PAGE_H - MARGIN * 2 - 60) / ROW_H));
  for (let page = 0; page * chunksPerPage < entries.length + 1; page += 1) {
    const lines: string[] = [];
    const y0 = PAGE_H - MARGIN - 40;
    if (page === 0) {
      lines.push(`BT /F1 14 Tf ${MARGIN} ${y0} Td (${escapeText(sanitize(title))}) Tj ET`);
    }
    const headerY = page === 0 ? y0 - 26 : y0;
    const cols = [
      { x: MARGIN, label: "WHEN" },
      { x: MARGIN + 130, label: "ACTOR" },
      { x: MARGIN + 260, label: "ACTION" },
      { x: MARGIN + 420, label: "METADATA" },
    ];
    lines.push(
      `BT /F2 9 Tf ${cols.map((c) => `${c.x} ${headerY} Td (${escapeText(c.label)}) Tj`).join(" ")} ET`,
    );
    for (let i = 0; i < chunksPerPage; i += 1) {
      const idx = page * chunksPerPage + i;
      const row = entries[idx];
      if (!row) break;
      const y = headerY - 22 - (i + 1) * ROW_H;
      const when = row.createdAt instanceof Date ? row.createdAt.toISOString().slice(0, 19).replace("T", " ") : String(row.createdAt ?? "").slice(0, 19);
      const actor = sanitize(String(row.actorId ?? "system")).slice(0, 34);
      const action = sanitize(String(row.action)).slice(0, 46);
      const meta = sanitize(JSON.stringify(row.metadata ?? {})).slice(0, 52);
      lines.push(
        `BT /F1 8 Tf ${cols[0]?.x ?? MARGIN} ${y} Td (${escapeText(when)}) Tj ${cols[1]?.x ?? MARGIN} ${y} Td (${escapeText(actor)}) Tj ${cols[2]?.x ?? MARGIN} ${y} Td (${escapeText(action)}) Tj ${cols[3]?.x ?? MARGIN} ${y} Td (${escapeText(meta)}) Tj ET`,
      );
    }
    const contentId = nextId(`<< /Length ${contentLen(lines.join("\n"))} >>\nstream\n${lines.join("\n")}\nendstream`);
    pages.push({ id: contentId, content: `<< /Length ${contentLen(lines.join("\n"))} >>\nstream\n${lines.join("\n")}\nendstream` });
  }

  // Fonts.
  const font1Id = nextId(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  const font2Id = nextId(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`);

  // Pages — parent placeholder (0 0 R) is patched once the root exists.
  const pageIds = pages.map((p) =>
    nextId(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${font1Id} 0 R /F2 ${font2Id} 0 R >> >> /Contents ${p.id} 0 R >>`),
  );
  const pagesRootId = nextId(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalogId = nextId(`<< /Type /Catalog /Pages ${pagesRootId} 0 R >>`);

  // Patch the page objects' parent to the real root.
  let pi = 0;
  for (const obj of objects) {
    if (obj.body.startsWith("<< /Type /Page /Parent 0 0 R")) {
      obj.body = `<< /Type /Page /Parent ${pagesRootId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${font1Id} 0 R /F2 ${font2Id} 0 R >> >> /Contents ${pages[pi]?.id ?? 0} 0 R >>`;
      pi += 1;
    }
  }

  // Serialize with correct offsets.
  const chunks: string[] = ["%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"];
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(chunks.join(""), "latin1"));
    chunks.push(`${obj.id} 0 obj\n${obj.body}\nendobj\n`);
  }
  const xrefStart = Buffer.byteLength(chunks.join(""), "latin1");
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const off of offsets) {
    chunks.push(`${String(off).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return Buffer.from(chunks.join(""), "latin1");
}
