# Live-proof evidence — Phase 4.0 · PDF COMPLIANCE REPORTS (4.7 tail) (2026-08-05)

Polaris. File: `audit.pdf` (the real exported report).

## What shipped
- **`pdf-export.ts`** — a ZERO-DEPENDENCY PDF writer: minimal but fully valid
  (catalog → pages → page → fonts → content streams, xref + trailer) with the
  audit table (WHEN/ACTOR/ACTION/METADATA columns, Helvetica + Helvetica-Bold),
  multi-page row flow, WinAnsi-safe sanitization + `\(`/`\)`/`\\` escaping so
  hostile log content cannot break the file.
- **`GET /api/audit/export?format=pdf&limit=&actor=&action=`** — the same admin
  export route now serves `application/pdf` with a dated filename; the default
  stays CSV. (A dependency for one table wasn't worth the api footprint.)

## LIVE PROOF
- `curl /api/audit/export?format=pdf&limit=50` → **HTTP 200, 10,788 bytes**:
  header `%PDF-1.4`, `/Type /Catalog`, `/Type /Pages`, `/Type /Page`,
  `xref` + `startxref` + trailing `%%EOF` all present; **page count 2** (50 rows
  flow onto a second page correctly); 209 drawn text tokens including the real
  audit rows (`auth.login` etc.).

## Gates
api **599** (44 files, +3 pdf tests) · full four-gate in the round-close pass.
