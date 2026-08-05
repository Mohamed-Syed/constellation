"use client";

import * as React from "react";
import { CalendarClock, Play, Power, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";

import { API_BASE } from "@/lib/api-base";
import { useAuth } from "@/components/auth/auth-provider";
import { hasPermission } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  cron: string;
  maxSteps: number;
  installed: boolean;
  enabled: boolean;
  scheduleId: string | null;
  nextRunAt: string | null;
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const CATEGORY_COLORS: Record<string, string> = {
  GitHub: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  Security: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  Infrastructure: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  Operations: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  Finance: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
};

/**
 * Skill marketplace (Phase 4.0 4.4): catalog cards with install state.
 * Install → a `skill:<id>` cron schedule; the scheduler runs it like any
 * other scheduled task.
 */
export function SkillsView() {
  const { token, permissions } = useAuth();
  const [skills, setSkills] = React.useState<Skill[] | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const isAdmin = hasPermission(permissions, "platform:admin");

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/skills`, { cache: "no-store", headers: authHeaders(token) });
      if (res.ok) setSkills((await res.json()) as Skill[]);
    } catch {
      /* keep last snapshot */
    }
  }, [token]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (id: string, action: "install" | "uninstall" | "toggle") => {
    setBusyId(id);
    try {
      const res = await fetch(`${API_BASE}/skills/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: authHeaders(token),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (!res.ok || body?.ok === false) {
        toast.error(`Skill ${action} failed.`);
        return;
      }
      toast.success(action === "install" ? "Skill installed — it will run on its schedule." : action === "uninstall" ? "Skill uninstalled." : "Skill toggled.");
      void refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            <Wrench className="size-6 text-accent" /> Skills
          </h1>
          <p className="mt-2 max-w-2xl text-neutral-500 dark:text-neutral-400">
            Pre-built agent skills: pick one, it runs on its schedule. Each install is a real cron
            schedule in the engine.
          </p>
        </div>
      </header>

      {!skills ? (
        <p className="py-16 text-center text-sm text-neutral-500">Loading skills…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((skill) => (
            <Card key={skill.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{skill.name}</CardTitle>
                  {skill.installed ? (
                    skill.enabled ? (
                      <Badge variant="success">active</Badge>
                    ) : (
                      <Badge variant="warning">paused</Badge>
                    )
                  ) : null}
                </div>
                <CardDescription className="min-h-10">{skill.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${CATEGORY_COLORS[skill.category] ?? "bg-neutral-100 dark:bg-neutral-800"}`}>
                    {skill.category}
                  </span>
                  <span className="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
                    <CalendarClock className="size-3.5" /> {skill.cron}
                  </span>
                  <span className="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
                    <Play className="size-3.5" /> {skill.maxSteps} steps
                  </span>
                </div>

                {skill.installed && skill.nextRunAt ? (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Next run: {new Date(skill.nextRunAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                ) : null}

                <div className="mt-auto flex items-center gap-2 pt-1">
                  {skill.installed ? (
                    <>
                      {isAdmin ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => void act(skill.id, "toggle")} disabled={busyId === skill.id} aria-label={`${skill.enabled ? "Pause" : "Resume"} ${skill.name}`}>
                          <Power className="size-3.5" /> {skill.enabled ? "Pause" : "Resume"}
                        </Button>
                      ) : null}
                      {isAdmin ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => void act(skill.id, "uninstall")} disabled={busyId === skill.id} aria-label={`Uninstall ${skill.name}`}>
                          <Trash2 className="size-3.5" /> Uninstall
                        </Button>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-neutral-400">
                          <ShieldCheck className="size-3.5" /> installed
                        </span>
                      )}
                    </>
                  ) : (
                    <Button type="button" size="sm" onClick={() => void act(skill.id, "install")} disabled={busyId === skill.id || !isAdmin} aria-label={`Install ${skill.name}`}>
                      <Play className="size-3.5" /> Install
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
