import { HealthDashboard } from "@/components/health/health-dashboard";

/**
 * `/health` — live engine health dashboard (Phase 2.0 item 2.4).
 *
 * Renders the public `GET /api/engine/health` payload (engine status, queue
 * depth, model availability, scheduler, supervisor, alert trail) as a live,
 * operator-facing page. Public endpoint → no auth gate needed; the component
 * polls client-side.
 */
export default function HealthPage() {
  return <HealthDashboard />;
}
