# Plugin SDK — for developers

> The `@constellation/plugin-sdk` is the contract everything plugs into. This article is the developer's quick reference for building a plugin.

## The shape of a plugin

```
plugins/<your-plugin>/
├── package.json        # name @constellation/<plugin>, exports, "main"
├── src/
│   ├── index.ts        # manifest + hooks (default export)
│   └── <tool>.ts       # tool implementations
└── tsconfig.json
```

## The manifest (v2)

The manifest declares identity, capabilities, lifecycle, and security posture:

```ts
export default {
  id: "my-plugin",
  name: "My Plugin",
  version: "0.1.0",
  description: "What it does",
  tools: [ /* tool definitions */ ],
  hooks: { onEnable, onDisable, onLoad },
  memory: { /* optional durable memory */ },
} satisfies PluginManifest;
```

- Tools are Zod-validated: `{ name, description, schema, requiresApproval?, run(ctx, args) }`.
- `requiresApproval: true` puts the tool behind the human approval gate (see **Approval gate**).
- The manifest version is bumped **additively** — the SDK evolves without breaking installed plugins.

## What a tool gets (the context)

The tool `run` receives a `PluginContext` with:

- a scoped **logger**,
- **settings / feature flags** access,
- a scoped **event bus** (emit and listen to platform events),
- optional **memory** (durable key-value),
- the parsed **arguments**.

## Loading & lifecycle

- The loader orders plugins **topologically** (dependencies first), detects cycles, and isolates failures (a broken plugin never takes down the platform).
- `onEnable` / `onDisable` are called on toggle; installs hot-reload via the loader's `reload()`.
- Optional **per-plugin Postgres schema**: the platform bootstraps `CREATE SCHEMA IF NOT EXISTS` before a plugin's first DB use.

## Sandboxing (opt-in)

Set `PLUGIN_SANDBOX_MODE=process` (with `PLUGIN_SANDBOX_PLUGINS=…`) to run plugins in child processes with timeout/heap/result caps and crash containment. Off by default.

## Contributing tools to the agent plane

1. Build the plugin.
2. Install it in the marketplace (see **Plugin marketplace**).
3. Its tools appear in the agent's prompt automatically; the ReAct loop calls them with validated args.

> **TIP:** The cleanest way to start — copy `plugins/hello-world` (the sample plugin) and extend it. The SDK ships TypeScript types for everything above.
