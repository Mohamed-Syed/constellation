import { getPlugins } from "@/lib/api";
import { LiveDashboard } from "@/components/dashboard/live-dashboard";

export default async function DashboardPage() {
  // SSR snapshot for first paint; the client component re-polls for live health.
  const plugins = await getPlugins();
  return <LiveDashboard initial={plugins} />;
}
