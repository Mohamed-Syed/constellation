# Security Policy & Architecture

Constellation treats security as a first-class design concern — it runs AI agents that can take
real actions, so guardrails are built into the architecture, not bolted on. This document covers
the security model, the honest threat posture, hardening guidance, and how to report a
vulnerability.

## Table of contents

1. [Reporting a vulnerability](#1-reporting-a-vulnerability)
2. [Security architecture](#2-security-architecture)
3. [Agent-specific guardrails](#3-agent-specific-guardrails)
4. [Threat model & posture](#4-threat-model--posture)
5. [Hardening checklist (before exposure)](#5-hardening-checklist-before-exposure)
6. [Secrets & data handling](#6-secrets--data-handling)

---

## 1. Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, use **[GitHub's private vulnerability reporting](https://github.com/Mohamed-Syed/constellation/security/advisories/new)**
("Report a vulnerability" under the repository's **Security** tab). Include:

- a description of the issue and its impact,
- steps to reproduce (a minimal PoC if possible),
- affected version/commit, and
- any suggested remediation.

We aim to acknowledge reports promptly, keep you updated on the fix, and credit you in the
advisory (unless you prefer to remain anonymous). Please give us reasonable time to release a fix
before any public disclosure.

---

## 2. Security architecture

```mermaid
flowchart TB
  REQ["Request"] --> GUARD["JwtAuthGuard (global APP_GUARD)"]
  GUARD -->|@Public| OPEN["allowed"]
  GUARD --> VERIFY["Composite token verifier"]
  VERIFY --> LJWT["Local JWT (HS256)"]
  VERIFY --> OIDC["OIDC (RS256, iss/aud/exp/nbf enforced)"]
  VERIFY -->|invalid| R401["401"]
  VERIFY -->|valid| PRIN["Principal (id, roles, permissions)"]
  PRIN --> PERM["PermissionsGuard (@RequirePermissions)"]
  PERM -->|lacks perm| R403["403 (audited)"]
  PERM --> CTRL["Controller → Service"]
  CTRL --> AUD["AuditService — every action, incl. denials"]
```

### Authentication

- **Local JWT** email/password (bcrypt-hashed) issued at login.
- **httpOnly, SameSite=Lax cookies** — the token is set as an httpOnly cookie (Secure in prod)
  so client-side JavaScript cannot read it, closing the `localStorage` XSS window. The bearer
  flow still works for API clients; the guard falls back to the cookie when no header is present.
- **OIDC/SSO** — a composite verifier tries local JWT first, then OIDC (Keycloak) when
  `OIDC_ISSUER_URL` is set. Only asymmetric (RS256) algorithms are accepted; `iss`, `aud`, `exp`,
  and `nbf` are all enforced. A tampered token is rejected with a 401 (proven live).

### Authorization (RBAC / ABAC)

- Permissions are **colon-scoped strings** (`<domain>:<resource>:<action>`) with **wildcard**
  matching (`billing:*` satisfies `billing:invoice:write`; `platform:admin` satisfies all).
- Seeded roles: `admin` (`platform:admin`) and `viewer` (`core:authenticated` only), so the
  403 denial path is real and testable.
- Guards enforce least-privilege per route (`@RequirePermissions` + `PermissionsGuard`), attached
  per-route (the decorator metadata alone does not enforce).

### Audit

- Every meaningful action — **including denials** — is recorded to an immutable-by-convention
  `AuditLog` (actor, action, target, metadata, timestamp).
- Tool-call **arguments and results are never logged**; only the fact, actor, and outcome.
- The trail is exportable to **CSV and PDF** (`GET /api/audit/export`) for compliance.

### Plugin isolation

- Plugins declare least-privilege permissions in their manifest; the two-layer authorization
  (route permission + the tool's own permission) gates every invocation.
- An **optional process-mode sandbox** (`PLUGIN_SANDBOX_MODE=process`, per-plugin opt-in) runs a
  tool in a child Node process with a wall-clock timeout (SIGKILL), a heap cap, a result-size cap,
  and crash containment — the child context is config + logger only (no db/events/memory). A
  crashing or hanging plugin cannot take down the platform.

---

## 3. Agent-specific guardrails

Because Constellation lets AI agents take real actions, it adds controls that traditional
platforms don't need:

- **Human-in-the-loop approval gate.** Tools flagged `requiresApproval` (or *all* tools under
  `ENGINE_REQUIRE_APPROVAL_ALL`) pause the task in a `pending_approval` state; a human must
  `POST /approve` or `/reject`. Approval is **honoured exactly once** — an approved step runs and
  is not re-paused. Both actions are audited with the actor.
- **Scoped agent privilege.** The engine agent runs under a named, exported permission set
  (`ENGINE_AGENT_PERMISSIONS`) — a documented seam to tighten — not raw `platform:admin`.
- **Hard budget caps.** A per-task token ceiling (`maxTokens ?? ENGINE_MAX_TOKENS_PER_TASK`)
  fails the task before unbounded spend; cost accounting flows through from cloud providers so
  the cap is a real dollar seam.
- **Bounded autonomy.** `ENGINE_MAX_STEPS` caps loop iterations; the **supervisor** recovers or
  dead-letters stuck tasks with a resume-once policy (no infinite spin).
- **Local-first data.** With Ollama as the default, prompts and tool results never leave the
  host unless you explicitly opt a task into a cloud model.

---

## 4. Threat model & posture

An honest map of what's protected today and what to address before exposure (condensed from the
project's own architecture review):

| Threat | Current protection | Residual gap / required control before exposure |
|---|---|---|
| Malicious / buggy plugin | Manifest permissions, least-privilege context, isolated failures, **optional** process sandbox | Sandbox is opt-in; network isolation is not enforced on all hosts. Enable the sandbox for untrusted plugins. |
| Prompt injection (via tool output / untrusted content) | Approval gate on consequential tools; args never executed as raw shell | Tag untrusted content, keep per-task tool allow-lists, human-gate irreversible actions. |
| Secret exposure | `.env` git-ignored, zero keys in the repo, pre-publish sweep | Use a secrets manager + rotation in production; never put secrets in prompts or logs. |
| Token / cost exhaustion | Per-task token budget + step cap + supervisor | Set per-day caps and a kill-switch for fleet-wide operation. |
| Audit tampering | Immutable-by-convention audit table | Append-only storage + a hash chain for tamper-evidence. |
| Token theft (XSS) | httpOnly SameSite cookies | Add CSRF protection (double-submit) for cookie-based mutations under hostile conditions. |
| Weak dev credentials (federation overlay) | Documented as dev-only | Prod-mode Keycloak, TLS, real passwords — **never** expose the overlay defaults. |
| Supply chain | Lockfile + frozen-install proof | Add dependency/SBOM scanning to CI; pin digests. |

**Posture in one line:** Constellation is production-*grade* in design and hardened for
local/single-node use, but a single Docker Compose host is **not** high availability, and the
federation overlay ships with development defaults. Read this document and the
[known limitations](docs/ROADMAP.md#known-limitations) before putting it on the public internet.

---

## 5. Hardening checklist (before exposure)

- [ ] Strong `JWT_SECRET`; all `changeme` passwords replaced.
- [ ] TLS everywhere (reverse proxy); HSTS on.
- [ ] SSO via a **prod-mode** Keycloak (persistent realm, real credentials) — not `start-dev`.
- [ ] Enable the plugin sandbox for any third-party plugin.
- [ ] Turn on `ENGINE_REQUIRE_APPROVAL_ALL` (or per-tool `requiresApproval`) for consequential tools.
- [ ] Set token **and** cost budgets; define a kill-switch procedure.
- [ ] Secrets in a manager (not `.env`) with rotation.
- [ ] Metrics + tracing enabled; alerts wired.
- [ ] Scheduled backups with a **rehearsed** restore.
- [ ] Dependency + container scanning in CI.

---

## 6. Secrets & data handling

- **Never commit secrets.** `.env` and `.env.*` are git-ignored (with `!.env.example`); real
  Keycloak/JWT tokens and generated graph output are git-ignored too.
- **`.env.example` contains placeholders only.** The repository ships with zero real keys.
- **Cloud model keys** (OpenRouter, DeepSeek) live only in `.env`. If a key is ever exposed
  (e.g. pasted into a chat), rotate it at the provider.
- **A PII/secret sweep is part of the publish workflow** — the repo has no employer identity or
  credentials in tracked files.
