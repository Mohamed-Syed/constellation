import type { Metadata } from "next";

import { DelegationsView } from "@/components/delegations/delegations-view";

export const metadata: Metadata = { title: "Delegations" };

export default function DelegationsPage() {
  return <DelegationsView />;
}
