import type { BadgeProps } from "@/components/ui/badge";
import type { PluginHealth, PluginState } from "@/lib/types";

/**
 * Small live status dot for health badges. A filled circle whose color encodes
 * status; `ok` gets a calm pulsing ring (CSS only, no JS) to signal "live",
 * while `degraded`/`down` are steady to read as alarm. Purely decorative — the
 * adjacent text label carries the real semantics for screen readers.
 */
export function HealthDot({ health }: { health: PluginHealth["status"] }) {
  const color =
    health === "ok"
      ? "bg-emerald-500"
      : health === "degraded"
        ? "bg-amber-500"
        : "bg-rose-500";
  return (
    <span className="relative inline-flex size-2.5 shrink-0" aria-hidden="true">
      {health === "ok" ? (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-60`} />
      ) : null}
      <span className={`relative inline-flex size-2.5 rounded-full ${color}`} />
    </span>
  );
}

const STATE_LABEL: Record<PluginState, string> = {
  discovered: "Discovered",
  validated: "Validated",
  registered: "Registered",
  enabled: "Enabled",
  disabled: "Disabled",
  failed: "Failed",
};

const STATE_VARIANT: Record<PluginState, NonNullable<BadgeProps["variant"]>> = {
  discovered: "neutral",
  validated: "info",
  registered: "info",
  enabled: "success",
  disabled: "neutral",
  failed: "danger",
};

const HEALTH_LABEL: Record<PluginHealth["status"], string> = {
  ok: "Healthy",
  degraded: "Degraded",
  down: "Down",
};

const HEALTH_VARIANT: Record<PluginHealth["status"], NonNullable<BadgeProps["variant"]>> = {
  ok: "success",
  degraded: "warning",
  down: "danger",
};

export function stateLabel(state: PluginState): string {
  return STATE_LABEL[state];
}

export function stateBadgeVariant(state: PluginState): NonNullable<BadgeProps["variant"]> {
  return STATE_VARIANT[state];
}

export function healthLabel(health: PluginHealth): string {
  return HEALTH_LABEL[health.status];
}

export function healthBadgeVariant(health: PluginHealth): NonNullable<BadgeProps["variant"]> {
  return HEALTH_VARIANT[health.status];
}
