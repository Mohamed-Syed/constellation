import type { Metadata } from "next";

import { getHealth, getPlugins } from "@/lib/api";
import { AdminConsole } from "@/components/admin/admin-console";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  // Each fetch degrades independently (null/[]), so a partial core failure never
  // blanks the whole admin surface. The federated catalog is fetched client-side
  // by `AdminConsole` (the /api/federation/modules route requires auth).
  const [health, plugins] = await Promise.all([getHealth(), getPlugins()]);
  return <AdminConsole health={health} plugins={plugins} />;
}
