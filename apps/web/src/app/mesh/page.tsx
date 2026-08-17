"use client";

import { MeshView } from "@/components/mesh/mesh-view";

/**
 * `/mesh` — Phase 4.0 4.6: federated agent mesh. The fleet topology with
 * register/probe/remove controls. Admin-only (core:mesh:manage — the nav
 * entry and the API guards both enforce it).
 */
export default function MeshPage() {
  return <MeshView />;
}
