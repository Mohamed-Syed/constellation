# Contributing to Constellation

Thank you for your interest in contributing! Constellation is built to be extended, and the
easiest, highest-leverage way to contribute is usually to **build a plugin** — the platform is
designed so new capabilities arrive as plugins without touching the core.

This guide covers the development workflow, coding standards, the verification discipline that
keeps the project honest, and how to submit changes.

## Table of contents

1. [Ways to contribute](#1-ways-to-contribute)
2. [Development setup](#2-development-setup)
3. [The verification discipline](#3-the-verification-discipline)
4. [Coding standards](#4-coding-standards)
5. [Commit & PR conventions](#5-commit--pr-conventions)
6. [Building a plugin](#6-building-a-plugin)
7. [Architecture guardrails](#7-architecture-guardrails)
8. [Environment notes](#8-environment-notes)

---

## 1. Ways to contribute

- 🧩 **Build a plugin** — add a capability (a new agent tool, a portal module) with no core
  changes. Start with [docs/PLUGIN_SDK.md](docs/PLUGIN_SDK.md) or `constellation generate plugin`.
- 🐛 **Fix a bug** — please include a regression test and, where the behavior is observable, a
  note on how you verified it live.
- ✨ **Improve the core** — engine, auth, observability, etc. Discuss larger changes in an issue
  first so we can keep the small-core philosophy intact.
- 📖 **Improve docs** — clarity, examples, and diagrams are always welcome.

Please open an issue to discuss significant changes before investing a lot of work, so we can
align on approach.

---

## 2. Development setup

```bash
git clone https://github.com/Mohamed-Syed/constellation.git
cd constellation
corepack enable
pnpm install
pnpm build
```

Run the apps in watch mode, or the full Docker stack — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). For AI features, install Ollama and pull a model
(everything runs local, $0).

---

## 3. The verification discipline

Constellation holds itself to an unusually high verification bar, and contributions are expected
to follow it. This is the project's core value and the main reason the codebase is trustworthy.

**1. Run the full gate before you claim something works:**

```bash
./node_modules/.bin/turbo run lint build typecheck test --force --concurrency=1
```

Use `--force` (Turbo's cache can report false greens) and `--concurrency=1` (parallel runs can
collide on this workspace). All 20 tasks must be green and tests must pass.

**2. Live proof beats green tests.** The single most important lesson from this project's history
is that **passing tests routinely hid real bugs** — an `import type` that silently disabled
request validation, a dishonest `ok:true` on a real failure, a missing peer dependency. If your
change is observable at runtime (an endpoint, a UI, an engine behavior), **exercise it against
real infrastructure** and describe what you saw in your PR. Assume anything you haven't run live
does not work yet.

**3. Maker/checker.** Don't self-approve. A reviewer independently re-runs the gate and, for
observable changes, verifies the behavior — not just the diff.

**4. Honesty is required.** Record what is and isn't verified. "Green offline, not run live" is a
perfectly respectable status; silently over-claiming is not.

---

## 4. Coding standards

- **TypeScript strict.** The repo's `tsconfig.base.json` enables `strict` and
  `noUncheckedIndexedAccess` — inherit it, don't loosen it.
- **Degrade, never crash.** Every service must boot and behave sanely with no database, no
  Redis, and no external sidecar. Inject cross-cutting services (`PrismaService`,
  `EventBusService`, `MetricsService`, `TracingService`) as **`@Optional()`** and check for
  their absence — see any existing core service for the pattern.
- **⚠️ Never use `import type` for a class that NestJS needs to inject or validate against.**
  `import type` is erased at compile time, so `emitDecoratorMetadata` loses the reference and
  DI/validation silently break while tests stay green. This exact bug has bitten this codebase
  multiple times. Use a **value import** for DTOs used in `@Body()` and for injected classes.
- **Windows-safe dynamic imports.** ESM plugins are loaded via `pathToFileURL()` +
  `new Function("s","return import(s)")` (to survive CJS downleveling). Don't "simplify" this
  away — it's load-bearing.
- **The SDK is a contract.** `packages/plugin-sdk` evolves **additively** and **versioned**
  (`manifestVersion`). A v1 manifest must keep working when v2 adds an optional field. Call out
  any SDK change explicitly.
- **No new dependencies without cause.** The codebase favors zero-dependency implementations
  (native `fetch`, `AbortSignal`, a hand-rolled cron parser, a zero-dep PDF/CSV writer). Prefer
  the platform's built-ins before adding a package.
- **Lint clean.** `eslint` must pass with zero errors. Match the surrounding code's style.

---

## 5. Commit & PR conventions

- **Conventional-style commit messages:** `feat(engine): …`, `fix(auth): …`, `docs: …`,
  `chore: …`, `test: …`. The subject line is imperative and concise; the body explains *why* and
  what was verified.
- **One logical change per PR** where practical. Include tests for new behavior and a note on
  live verification for observable changes.
- **PR description** should cover: what changed, why, how you verified it (gates + any live
  proof), and any known gaps or follow-ups.
- **Never commit secrets.** `.env` is git-ignored; keep it that way. Run a quick
  `git grep`-style sweep for keys/tokens before pushing.
- Green CI is required before merge.

---

## 6. Building a plugin

A plugin is a directory in `plugins/` with a `plugin.manifest.json` (data) and a built ESM entry
(code) that implements the `Plugin` lifecycle. The core discovers, validates, and loads it — no
core changes needed.

```bash
constellation generate plugin my-plugin    # scaffolds a fully-typed starter
# …edit the manifest + tools…
pnpm --filter @constellation/plugin-my-plugin build
# drop it under plugins/ (or install via the marketplace) and restart the core
```

Full walkthrough — manifest fields, lifecycle hooks, the capability context, permissions, and how
the loader works — is in **[docs/PLUGIN_SDK.md](docs/PLUGIN_SDK.md)**.

---

## 7. Architecture guardrails

Please respect the principles that keep the platform coherent (see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

- **Small core.** New capabilities are plugins, not core features. If you're adding a feature to
  the core, it should be a genuinely cross-cutting *platform service* (auth, audit, the engine),
  not a domain capability.
- **Two planes, one contract.** Portal federation is data (`config/modules.yaml`); agent
  capabilities are plugin tools. Don't cram a standalone tool into the core.
- **Federate, don't reimplement.** Heavyweight tools (Grafana, Keycloak, etc.) are federated as
  tiles, not rebuilt.

---

## 8. Environment notes

A few host-specific facts that save time (especially on Windows dev hosts):

- Use `./node_modules/.bin/turbo` for gates; always `--force --concurrency=1`.
- If a dev port is squatted, remap host ports via env (see DEPLOYMENT.md) — don't fight the port.
- Large local models on CPU can exceed the default `MODEL_TIMEOUT_MS`; raise it to `180000` for
  live engine testing.
- Kill a stale API process by **port owner**, then confirm the port is free, before rebooting —
  a lingering process can serve old code and produce phantom failures.

---

By contributing, you agree that your contributions are licensed under the project's
[Apache License 2.0](LICENSE). Please also read our [Code of Conduct](CODE_OF_CONDUCT.md).

**Thank you for helping build Constellation. 🚀**
