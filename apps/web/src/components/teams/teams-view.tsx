"use client";

import * as React from "react";
import { Loader2, Plus, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { hasPermission } from "@/lib/permissions";
import {
  addTeamMember,
  createTeam,
  fetchMyTeams,
  fetchTeamDetail,
  removeTeamMember,
  type TeamDetailView,
  type TeamSummary,
} from "@/lib/teams";

const ROLE_LABELS: Record<string, string> = { owner: "OWNER", admin: "ADMIN", member: "MEMBER" };

/**
 * Team spaces (Phase 3.0 item 3.7): my teams, create a team, manage members.
 * The API enforces the RBAC (owner/admin manage members); the UI hides the
 * management controls for non-managers.
 */
export function TeamsView() {
  const { token, permissions } = useAuth();
  const [teams, setTeams] = React.useState<TeamSummary[] | null>(null);
  const [selected, setSelected] = React.useState<TeamSummary | null>(null);
  const [detail, setDetail] = React.useState<TeamDetailView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [memberEmail, setMemberEmail] = React.useState("");
  const [memberRole, setMemberRole] = React.useState("member");

  const isAdmin = hasPermission(permissions, "platform:admin");

  const load = React.useCallback(async () => {
    const mine = await fetchMyTeams(token);
    setTeams(mine);
    if (selected) {
      const current = mine.find((t) => t.id === selected.id) ?? null;
      setSelected(current);
      if (!current) setDetail(null);
    }
  }, [token, selected]);

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  React.useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let active = true;
    void fetchTeamDetail(token, selected.id).then((d) => {
      if (active) setDetail(d);
    });
    return () => {
      active = false;
    };
  }, [selected, token]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    const team = await createTeam(token, newName.trim());
    setBusy(false);
    if (!team) {
      toast.error("Could not create the team.");
      return;
    }
    toast.success(`Team "${team.name}" created — you are its owner.`);
    setNewName("");
    setTeams(await fetchMyTeams(token));
    setSelected(team);
  };

  const handleAddMember = async () => {
    if (!selected || !memberEmail.trim()) return;
    setBusy(true);
    const member = await addTeamMember(token, selected.id, memberEmail.trim(), memberRole);
    setBusy(false);
    if (!member) {
      toast.error(`No user with email "${memberEmail.trim()}" exists.`);
      return;
    }
    toast.success(`${member.email} added as ${member.role}.`);
    setMemberEmail("");
    setDetail(await fetchTeamDetail(token, selected.id));
  };

  const handleRemove = async (member: { userId: string; email: string; role: string }) => {
    if (!selected) return;
    if (member.role === "owner") {
      toast.error("The owner cannot be removed.");
      return;
    }
    setBusy(true);
    const ok = await removeTeamMember(token, selected.id, member.userId);
    setBusy(false);
    if (!ok) {
      toast.error("Could not remove that member.");
      return;
    }
    toast.success(`${member.email} removed.`);
    setDetail(await fetchTeamDetail(token, selected.id));
  };

  const canManage = (team: TeamSummary) => isAdmin || team.role === "owner" || team.role === "admin";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
        <p className="text-sm text-muted-foreground">
          Organization → Team → User memberships. Team tasks are visible to the team; member management is owner/admin-only.
        </p>
      </div>

      <Card className="press-scale">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Create a team
          </CardTitle>
          <CardDescription>
            Creates the organization + team in one step; you become the owner.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Input
            aria-label="Team name"
            placeholder="e.g. platform-eng"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
          />
          <Button onClick={() => void handleCreate()} disabled={busy || !newName.trim()} className="press-scale">
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            Create team
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" /> My teams
            </CardTitle>
            <CardDescription>Teams you belong to, with your role.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {teams === null ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="animate-spin" /> Loading…
              </div>
            ) : teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">No teams yet — create one above.</p>
            ) : (
              teams.map((team) => (
                <button
                  key={team.id}
                  onClick={() => setSelected(team)}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                    selected?.id === team.id
                      ? "border-primary/50 bg-primary/5"
                      : "hover:bg-surface-2"
                  }`}
                >
                  <span className="text-sm font-medium">{team.name}</span>
                  <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {ROLE_LABELS[team.role] ?? team.role}
                  </span>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {selected && detail ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> {selected.name}
              </CardTitle>
              <CardDescription>
                {detail.members.length} member{detail.members.length === 1 ? "" : "s"} ·{" "}
                {canManage(selected) ? "you can manage members" : "read-only for your role"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                {detail.members.map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center justify-between rounded-lg border px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{member.email}</span>
                      <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {ROLE_LABELS[member.role] ?? member.role}
                      </span>
                    </div>
                    {canManage(selected) && member.role !== "owner" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleRemove(member)}
                        disabled={busy}
                        aria-label={`Remove ${member.email}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>

              {canManage(selected) ? (
                <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Add member by email
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      aria-label="Member email"
                      placeholder="colleague@company.com"
                      value={memberEmail}
                      onChange={(e) => setMemberEmail(e.target.value)}
                    />
                    <select
                      aria-label="Member role"
                      value={memberRole}
                      onChange={(e) => setMemberRole(e.target.value)}
                      className="h-9 w-full rounded-lg border bg-surface px-2 text-sm sm:w-32"
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                    <Button
                      onClick={() => void handleAddMember()}
                      disabled={busy || !memberEmail.trim()}
                      className="press-scale"
                    >
                      {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
                      Add
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {selected ? "Loading team…" : "Select a team to manage its members."}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
