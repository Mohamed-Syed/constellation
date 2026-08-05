"use client";

import { TeamsView } from "@/components/teams/teams-view";

/**
 * `/teams` — Phase 3.0 item 3.7: team spaces. My teams, create a team, manage
 * members (owner/admin only — the API enforces it; the UI hides the controls).
 */
export default function TeamsPage() {
  return <TeamsView />;
}
