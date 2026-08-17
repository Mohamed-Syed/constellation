# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-08-17

Initial public release.

### Added

- **Portal plane** — single sign-on (local JWT + OIDC/Keycloak), federated tool tiles
  behind a reverse proxy, a live `/engine` task console, `/health` dashboard,
  `/compare` multi-model A/B, an in-app knowledge base, a plugin marketplace with
  hot-reload, a visual workflow builder, a notification center with
  webhook/Slack/Discord/Teams/SMTP channels, and team spaces (Organization → Team →
  member roles).
- **Agent engine** — durable BullMQ task queue with checkpoint-per-step and
  kill-restart resume, a ReAct loop with real tool calling, a human-in-the-loop
  approval gate, a provider-agnostic model router (Ollama / OpenRouter / DeepSeek)
  with automatic fallback and cost-aware budgets, a cron + event scheduler, a
  supervisor + dead-letter trail, and crews (agent-to-agent delegation).
- **Agentic AI Controller** — live stability score (0–100) with findings that name
  the problem, whitelisted one-click recovery actions, and an autonomous watch that
  scores and heals the platform on a cadence (every action audited).
- **Plugin SDK** (`@constellation/plugin-sdk`) — manifest, lifecycle, plugin context,
  permissions, and the loader that enforces them.
- **Observability** — Prometheus metrics, OpenTelemetry tracing (OTLP), Grafana
  dashboards.
- **Security** — RBAC/ABAC with colon-scoped permissions, httpOnly/SameSite cookie
  auth, immutable audit trail with CSV/PDF export, optional process-mode plugin
  sandboxing.
- **Governance** — Apache-2.0 license, README, architecture/deployment/SDK/roadmap
  documentation, contributing guide, security policy, and code of conduct.
