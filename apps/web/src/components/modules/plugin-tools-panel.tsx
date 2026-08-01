"use client";

import * as React from "react";
import { AlertTriangle, Lock, Play, Sparkles } from "lucide-react";

import type { PluginDetail, PluginTool } from "@/lib/types";
import { invokeTool } from "@/lib/tool-invoke";
import { useAuth } from "@/components/auth/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * The "Tools" tab body on a plugin's detail page (P4 agent-plane capabilities).
 *
 * Renders each declared agent-plane tool and an invoke form. Invocation targets
 * the documented (not-yet-implemented) route:
 *   POST /api/plugins/:id/tools/:toolName/invoke
 * See `lib/tool-invoke.ts` for the full contract + graceful degradation. When
 * the route 404s (expected today) the form flips to a disabled "coming soon"
 * state instead of erroring — the UI is built to the contract, not blocked by it.
 */
export function PluginToolsPanel({ plugin }: { plugin: PluginDetail }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Sparkles className="size-4" />
        </span>
        <div>
          <CardTitle className="text-base">Agent-plane tools</CardTitle>
          <CardDescription>
            Callable capabilities this plugin exposes to the agent plane.
            {plugin.supportsToolInvocation
              ? " Runtime implements the invoke seam."
              : " Runtime does not implement invokeTool yet."}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="space-y-4">
          {plugin.tools.map((tool) => (
            <ToolRow key={tool.name} pluginId={plugin.id} tool={tool} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ToolRow({ pluginId, tool }: { pluginId: string; tool: PluginTool }) {
  const { token, permissions } = useAuth();
  const [argsText, setArgsText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [outcome, setOutcome] = React.useState<
    { kind: "ok"; result: unknown } | { kind: "error"; message: string } | null
  >(null);

  // Parse the args textarea into an object; tolerate empty + malformed JSON.
  const parsedArgs = React.useMemo<{ value: Record<string, unknown> | null; error: string | null }>(() => {
    const trimmed = argsText.trim();
    if (!trimmed) return { value: {}, error: null };
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { value: null, error: "Arguments must be a JSON object, e.g. {\"url\": \"https://…\"}." };
      }
      return { value: parsed as Record<string, unknown>, error: null };
    } catch {
      return { value: null, error: "Invalid JSON. Example: {\"key\": \"value\"}" };
    }
  }, [argsText]);

  const canInvoke = (permissions ?? []).some(
    (h) => h === tool.permission || h === "platform:admin" || (h.endsWith(":*") && tool.permission.startsWith(h.slice(0, -1))),
  );

  async function handleInvoke() {
    if (!parsedArgs.value) return;
    setSubmitting(true);
    setOutcome(null);
    const res = await invokeTool(pluginId, tool.name, parsedArgs.value, token);
    setSubmitting(false);
    if (res.ok) {
      setOutcome({ kind: "ok", result: res.result });
    } else {
      // 404 → "coming soon" (route not wired yet). Other reasons stay as errors.
      if (res.reason === "not-found") {
        setOutcome({ kind: "error", message: "Tool invocation isn't available yet on the server." });
      } else {
        setOutcome({ kind: "error", message: res.message });
      }
    }
  }

  const isComingSoon = outcome?.kind === "error" && outcome.message.startsWith("Tool invocation isn't");

  return (
    <li className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex items-center gap-2">
        <code className="font-mono text-sm font-medium text-neutral-800 dark:text-neutral-200">{tool.name}</code>
        <Badge variant="neutral" className="font-mono text-[10px]">
          {tool.permission}
        </Badge>
        {!canInvoke ? (
          <Badge variant="warning" className="ml-auto gap-1">
            <Lock className="size-3" /> no permission
          </Badge>
        ) : null}
      </div>
      {tool.description ? (
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{tool.description}</p>
      ) : null}
      {Object.keys(tool.inputSchema ?? {}).length > 0 ? (
        <pre className="mt-2 overflow-x-auto rounded-md bg-neutral-100 p-2 text-xs text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
          {JSON.stringify(tool.inputSchema, null, 2)}
        </pre>
      ) : null}

      {/* Invoke form — only meaningful when the user can invoke and the runtime supports it. */}
      <div className="mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <label htmlFor={`args-${tool.name}`} className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
          Arguments (JSON)
        </label>
        <textarea
          id={`args-${tool.name}`}
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          rows={2}
          placeholder='{ "key": "value" }'
          spellCheck={false}
          disabled={isComingSoon || !canInvoke}
          className="w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-xs shadow-sm transition-colors placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-900"
        />

        {parsedArgs.error ? (
          <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {parsedArgs.error}
          </p>
        ) : null}

        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={handleInvoke}
            disabled={isComingSoon || !canInvoke || submitting || Boolean(parsedArgs.error)}
            aria-busy={submitting}
          >
            {submitting ? null : <Play className="size-3.5" />}
            {isComingSoon ? "Coming soon" : "Invoke"}
          </Button>

          {!canInvoke ? (
            <span className="text-xs text-neutral-400 dark:text-neutral-500">
              Requires the <code className="font-mono">{tool.permission}</code> permission.
            </span>
          ) : null}
        </div>

        {outcome ? (
          <div
            role="status"
            className={
              outcome.kind === "ok"
                ? "mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/40"
                : "mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300"
            }
          >
            {outcome.kind === "ok" ? (
              <pre className="overflow-x-auto text-xs">{JSON.stringify(outcome.result, null, 2)}</pre>
            ) : (
              <span className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {outcome.message}
              </span>
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}
