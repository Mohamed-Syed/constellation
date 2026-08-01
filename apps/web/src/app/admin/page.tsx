import type { Metadata } from "next";

import { getHealth, getPlugins } from "@/lib/api";
import { getFederatedTools } from "@/lib/federated-api";
import { AdminConsole } from "@/components/admin/admin-console";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  // Each fetch degrades independently (null/[]/empty catalog), so a partial
  // core failure never blanks the whole admin surface.
  const [health, plugins, federated] = await Promise.all([
    getHealth(),
    getPlugins(),
    getFederatedTools(),
  ]);
  return <AdminConsole health={health} plugins={plugins} federated={federated} />;
}
