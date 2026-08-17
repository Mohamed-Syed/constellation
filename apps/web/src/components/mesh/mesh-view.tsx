"use client";

import * as React from "react";
import { Activity, KeyRound, Loader2, Plus, Radio, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatAgo } from "@/lib/use-live";
import {
  DEFAULT_POLL_MS,
  EMPTY_COUNTS,
  fetchMeshTopology,
  probeMeshPeer,
  registerMeshPeer,
  removeMeshPeer,
  type MeshPeerStatus,
  type MeshPeerView,
  type MeshTopologyView,
} from "@/lib/mesh";

/** Peer status → the shared Badge variant (up/down/unknown map to success/danger/neutral). */
const STATUS_VARIANT: Record<MeshPeerStatus, "success" | "danger" | "neutral"> = {
  up: "success",
  down: "danger",
  unknown: "neutral",
};

/**
 * Federated agent mesh (Phase 4.0 4.6) — the fleet topology: every registered
 * Constellation instance, its live probe status, and register/probe/remove
 * controls. Admin-only (core:mesh:manage — the API enforces it; the nav entry
 * is hidden for non-admins). Cross-instance task routing is the next step.
 */
export function MeshView() {
  const { token } = useAuth();
  const [topology, setTopology] = React.useState<MeshTopologyView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [probeId, setProbeId] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const seqRef = React.useRef(0);

  const load = React.useCallback(async () => {
    // Monotonic sequence guard: a slower earlier poll must never clobber a
    // newer one (out-of-order setTopology after an action-triggered reload).
    const seq = ++seqRef.current;
    try {
      const top = await fetchMeshTopology(token);
      if (seq !== seqRef.current) return;
      if (top) {
        setTopology(top);
        setLoadError(null);
      } else {
        // !ok → null is the house degrade pattern; surface it so a 401 token
        // expiry or a dead API isn't a frozen topology with no hint.
        setLoadError("Refresh failed - the mesh API did not answer.");
      }
    } catch {
      if (seq !== seqRef.current) return;
      setLoadError("Connection to the mesh API was lost. Retrying…");
    }
  }, [token]);

  React.useEffect(() => {
    void load();
    // Self-align with the prober's cadence (the API exposes probeIntervalMs):
    // polling faster than data can change just wastes requests.
    const timer = setInterval(() => void load(), topology?.probeIntervalMs ?? DEFAULT_POLL_MS);
    return () => clearInterval(timer);
  }, [load, topology?.probeIntervalMs]);

  const handleRegister = async () => {
    if (!name.trim() || !baseUrl.trim()) {
      toast.error("Name and base URL are required.");
      return;
    }
    setBusy(true);
    const result = await registerMeshPeer(token, {
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim() || undefined,
    });
    setBusy(false);
    if (!("peer" in result)) {
      toast.error(result.error);
      return;
    }
    toast.success(`Peer "${result.peer.name}" registered - initial probe: ${result.peer.status.toUpperCase()}.`);
    setName("");
    setBaseUrl("");
    setApiKey("");
    await load();
  };

  const handleProbe = async (peer: MeshPeerView) => {
    setProbeId(peer.id);
    const updated = await probeMeshPeer(token, peer.id);
    setProbeId(null);
    if (!updated) {
      toast.error(`Could not probe "${peer.name}".`);
      return;
    }
    toast.success(`"${peer.name}" is ${updated.status.toUpperCase()}.`);
    await load();
  };

  const handleRemove = async (peer: MeshPeerView) => {
    setBusy(true);
    const ok = await removeMeshPeer(token, peer.id);
    setBusy(false);
    if (!ok) {
      toast.error(`Could not remove "${peer.name}".`);
      return;
    }
    toast.success(`Peer "${peer.name}" removed from the mesh.`);
    await load();
  };

  const counts = topology?.counts ?? EMPTY_COUNTS;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agent Mesh</h1>
        <p className="text-sm text-muted-foreground">
          The Constellation fleet - every registered instance and its live health. The prober polls
          each peer&apos;s <code>/api/health</code>; 2xx means UP.
        </p>
      </div>

      <div className="stats w-full border border-base-300 bg-base-100 shadow-sm">
        {(
          [
            ["TOTAL", counts.total, "text-base-content"],
            ["UP", counts.up, "text-emerald-600 dark:text-emerald-400"],
            ["DOWN", counts.down, "text-red-600 dark:text-red-400"],
            ["UNKNOWN", counts.unknown, "text-base-content/50"],
          ] as const
        ).map(([label, value, className]) => (
          <div className="stat" key={label}>
            <div className={`stat-value font-mono tabular-nums ${className}`}>{value}</div>
            <div className="stat-title text-xs uppercase tracking-wider text-base-content/50">{label}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="h-4 w-4" /> Register a peer
          </CardTitle>
          <CardDescription>
            A peer is another Constellation instance. Only a SHA-256 hash of its API key is stored -
            never the key itself.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Input
            placeholder="Name (e.g. edge-site-1)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="sm:max-w-[200px]"
            aria-label="Peer name"
          />
          <Input
            placeholder="Base URL (e.g. http://localhost:4002)"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="flex-1"
            aria-label="Peer base URL"
          />
          <Input
            placeholder="API key (optional - hashed)"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="sm:max-w-[200px]"
            aria-label="Peer API key"
          />
          <Button onClick={() => void handleRegister()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add peer
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Topology</CardTitle>
            <CardDescription>
              Auto-refreshes at the prober&apos;s cadence.
              {loadError ? (
                <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">{loadError}</span>
              ) : null}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {!topology ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading topology…
            </div>
          ) : topology.peers.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No peers registered yet. Add your first Constellation instance above.
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {topology.peers.map((peer) => (
                <li
                  key={peer.id}
                  className="flex flex-col gap-2 rounded-xl border bg-surface/50 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{peer.name}</span>
                      <Badge variant={STATUS_VARIANT[peer.status]}>{peer.status.toUpperCase()}</Badge>
                      {peer.apiKeyHash ? (
                        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" aria-label="API key registered" />
                      ) : null}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">{peer.baseUrl}</div>
                    {peer.lastError ? (
                      <div className="truncate text-xs text-red-500/80">{peer.lastError}</div>
                    ) : null}
                    <div className="text-xs text-muted-foreground">
                      Last seen {formatAgo(peer.lastSeen ? new Date(peer.lastSeen).getTime() : null)}
                      {peer.lastProbedAt
                        ? ` · probed ${formatAgo(new Date(peer.lastProbedAt).getTime())}`
                        : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleProbe(peer)}
                      disabled={probeId === peer.id}
                    >
                      {probeId === peer.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Activity className="h-3.5 w-3.5" />
                      )}
                      Probe
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleRemove(peer)}
                      disabled={busy}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
