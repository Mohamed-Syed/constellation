import type { Metadata } from "next";

import { getHealth, getPlugins } from "@/lib/api";
import { AdminConsole } from "@/components/admin/admin-console";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  // Both fetches degrade to `null`/[] independently, so a partial core failure
  // never blanks the whole admin surface.
  const [health, plugins] = await Promise.all([getHealth(), getPlugins()]);
  return <AdminConsole health={health} plugins={plugins} />;
}
