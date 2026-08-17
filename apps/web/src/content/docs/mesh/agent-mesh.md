# Agent mesh

> Connect multiple Constellation instances into a federated mesh. Every peer's health is probed continuously, the topology is visible in the portal, and tasks can be routed to other instances.

## Concepts

| Term | Meaning |
|---|---|
| **Peer** | Another Constellation instance, registered by name + base URL |
| **API key** | Optional shared secret per peer — stored **hash-only** (SHA-256); the raw key is never persisted |
| **Status** | `unknown` → `up` / `down` after a probe |
| **Topology** | The list of peers with per-status counts |

## Registering a peer

1. Open **Mesh** (`/mesh`).
2. In **Add peer**, enter:
   - **Name** (unique — a duplicate returns a clear `409 A peer with that name already exists.`),
   - **Base URL** (e.g. `http://localhost:4002`),
   - optional **API key**.
3. Save — the platform **probes immediately** so the topology is truthful from second zero.

## Health probing

- The prober checks each peer's `/api/health` every `MESH_PROBE_INTERVAL_MS` (default 60000) — **any 2xx means up** (a reachable instance is reachable whether its health says ok or degraded).
- A probe failure is a **data update** (`down` + the real reason, e.g. `connect ECONNREFUSED`), never an exception.
- **Probe** on a peer row forces an immediate check.
- Peers display `lastSeen` and `lastError` so you see exactly when and why a peer went down.

## Reading the topology

- **Portal `/mesh`**: count cards (total/up/down/unknown), per-peer rows with UP/DOWN/UNKNOWN badges.
- **API**: `GET /api/mesh/topology` (admin: `core:mesh:manage`).
- **AI Controller**: a down peer becomes a `mesh-down` finding that **names the peer** — and the autonomous watch **reprobes** it on its own.

## Routing tasks to another instance

1. The receiver instance must set `MESH_ROUTE_API_KEY` (the shared secret; unset ⇒ routing disabled, 403).
2. `POST /api/mesh/peers/:id/route` (sender, admin) forwards a task to the peer's `/api/engine/mesh/forward`; the peer enqueues and runs it.
3. The response is discriminated: `{ok, taskId, status}` on success, `{ok:false, error}` otherwise (a DB-less target yields an actionable message).

> **NOTE:** Routing requires a full DB-backed target instance. This is documented behavior, not a bug.

## Removing a peer

**Remove** on the peer row deletes the registration; a racing probe is isolated so a mid-sweep removal never corrupts the sweep.

## RBAC

Mesh management (`GET /topology`, `POST /peers`, `POST /:id/probe`, `POST /:id/route`, `DELETE /:id`) requires `core:mesh:manage` (`platform:admin` implies it). Viewers get 403.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `MESH_PROBE_INTERVAL_MS` | `60000` | Probe cadence |
| `MESH_PROBE_TIMEOUT_MS` | `5000` | Per-peer probe timeout |
| `MESH_ROUTE_API_KEY` | *(unset)* | Shared secret enabling cross-instance task routing |
