/**
 * A tiny, dependency-free force-directed layout.
 *
 * Deliberately hand-written instead of pulling in d3-force / react-force-graph:
 * the portal's dependency set is orchestrator-owned and this is ~120 lines of
 * well-understood physics. It's a standard Fruchterman-Reingold-ish simulation:
 *
 *   - repulsion  — every pair pushes apart with a Coulomb-like k²/d force
 *                  (O(n²); fine at the few-hundred-node scale we cap the view to)
 *   - attraction — every edge pulls together with a Hooke-like d²/k force
 *   - gravity    — a weak pull toward the centre so disconnected components
 *                  don't drift off-canvas
 *   - cooling    — a linearly-decaying temperature caps per-tick displacement
 *                  so the layout settles instead of oscillating forever
 *
 * The simulation is SYNCHRONOUS and deterministic: given the same nodes/edges it
 * produces the same layout every time (seeded PRNG, fixed iteration count), which
 * keeps SSR/hydration stable and makes the view testable. It is run once off the
 * main render path (in a `useMemo`) rather than animated per-frame — a settled
 * static graph is what a knowledge-graph reader actually wants, and it costs no
 * requestAnimationFrame loop or battery.
 */

export interface LayoutInputNode {
  id: string;
  /** Optional grouping used only for colouring by the renderer. */
  type?: string;
}

export interface LayoutInputEdge {
  source: string;
  target: string;
}

export interface PositionedNode extends LayoutInputNode {
  x: number;
  y: number;
  /** Number of incident edges — drives node radius in the renderer. */
  degree: number;
}

export interface PositionedEdge extends LayoutInputEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Layout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  width?: number;
  height?: number;
  iterations?: number;
  /** Hard cap on rendered nodes; the highest-degree nodes win. Keeps the O(n²) pass cheap. */
  maxNodes?: number;
}

/**
 * The portal compiles with `noUncheckedIndexedAccess`, so a raw
 * `Float64Array[i]` reads as `number | undefined` even though every index in
 * this file is provably in range (all loops are `i < count`). Rather than
 * sprinkle `!`/`??` through the physics inner loop, the buffer is wrapped in a
 * tiny accessor class: `get`/`set`/`add` are typed `number`, the backing store
 * stays a packed Float64Array, and the noise lives in exactly one place.
 */
class DenseFloats {
  private readonly data: Float64Array;

  constructor(size: number) {
    this.data = new Float64Array(size);
  }

  get(i: number): number {
    return this.data[i] as number;
  }

  set(i: number, value: number): void {
    this.data[i] = value;
  }

  add(i: number, delta: number): void {
    this.data[i] = (this.data[i] as number) + delta;
  }

  fill(value: number): void {
    this.data.fill(value);
  }
}

/** Deterministic PRNG (mulberry32) — same layout on server and client, no hydration drift. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lay out a graph. Never throws: an empty graph yields an empty layout, and
 * edges referencing unknown nodes are ignored (the caller normalizes too, but
 * this stays total on its own so it can be reused).
 */
export function forceLayout(
  inputNodes: readonly LayoutInputNode[],
  inputEdges: readonly LayoutInputEdge[],
  options: LayoutOptions = {},
): Layout {
  const width = options.width ?? 960;
  const height = options.height ?? 560;
  const maxNodes = options.maxNodes ?? 300;

  // Degree first — it decides both which nodes survive the cap and how big they draw.
  const degree = new Map<string, number>();
  for (const n of inputNodes) degree.set(n.id, 0);
  for (const e of inputEdges) {
    if (degree.has(e.source)) degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    if (degree.has(e.target)) degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  // Cap to the most-connected nodes so a huge corpus still renders readably and fast.
  let kept = inputNodes;
  if (inputNodes.length > maxNodes) {
    kept = [...inputNodes]
      .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
      .slice(0, maxNodes);
  }
  const keptIds = new Set(kept.map((n) => n.id));
  const edges = inputEdges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));

  const count = kept.length;
  if (count === 0) return { nodes: [], edges: [], width, height };

  // Brain-page UX round: ADAPTIVE iteration count — the O(n²) repulsion pass
  // dominates; at the 300-node cap the full 300 iterations costs a noticeable
  // main-thread block on every layout. Scale it down by size (small graphs
  // keep the high-quality settle, big ones stay responsive). Callers can
  // still override with an explicit `iterations`.
  const iterations = options.iterations ?? (count > 250 ? 150 : count > 150 ? 220 : 300);

  const random = makeRandom(1337);
  const index = new Map<string, number>();
  const xs = new DenseFloats(count);
  const ys = new DenseFloats(count);

  // Seed on a circle (+ jitter) rather than uniformly at random: a ring starts
  // the simulation with no coincident points, which avoids infinite repulsion.
  const seedRadius = Math.min(width, height) * 0.38;
  kept.forEach((node, i) => {
    index.set(node.id, i);
    const angle = (2 * Math.PI * i) / count;
    xs.set(i, width / 2 + Math.cos(angle) * seedRadius * (0.6 + random() * 0.4));
    ys.set(i, height / 2 + Math.sin(angle) * seedRadius * (0.6 + random() * 0.4));
  });

  if (count === 1) {
    xs.set(0, width / 2);
    ys.set(0, height / 2);
  }

  // Ideal edge length: spread the nodes over the available area.
  const k = Math.sqrt((width * height) / count) * 0.55;
  const dx = new DenseFloats(count);
  const dy = new DenseFloats(count);
  let temperature = Math.min(width, height) * 0.12;
  const cooling = temperature / (iterations + 1);

  const edgePairs = edges
    .map((e) => [index.get(e.source), index.get(e.target)] as const)
    .filter((p): p is readonly [number, number] => p[0] !== undefined && p[1] !== undefined);

  for (let step = 0; step < iterations; step += 1) {
    dx.fill(0);
    dy.fill(0);

    // Repulsion between every pair (symmetric — compute once, apply twice).
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        let ddx = xs.get(i) - xs.get(j);
        let ddy = ys.get(i) - ys.get(j);
        let distSq = ddx * ddx + ddy * ddy;
        if (distSq < 0.01) {
          // Coincident: nudge deterministically so the force is finite.
          ddx = (random() - 0.5) * 0.1 || 0.05;
          ddy = (random() - 0.5) * 0.1 || 0.05;
          distSq = ddx * ddx + ddy * ddy;
        }
        const dist = Math.sqrt(distSq);
        const force = (k * k) / dist;
        const ux = (ddx / dist) * force;
        const uy = (ddy / dist) * force;
        dx.add(i, ux);
        dy.add(i, uy);
        dx.add(j, -ux);
        dy.add(j, -uy);
      }
    }

    // Attraction along edges.
    for (const [a, b] of edgePairs) {
      const ddx = xs.get(a) - xs.get(b);
      const ddy = ys.get(a) - ys.get(b);
      const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
      const force = (dist * dist) / k;
      const ux = (ddx / dist) * force;
      const uy = (ddy / dist) * force;
      dx.add(a, -ux);
      dy.add(a, -uy);
      dx.add(b, ux);
      dy.add(b, uy);
    }

    // Weak gravity toward the centre keeps isolated nodes on-canvas.
    for (let i = 0; i < count; i += 1) {
      dx.add(i, (width / 2 - xs.get(i)) * 0.012);
      dy.add(i, (height / 2 - ys.get(i)) * 0.012);
    }

    // Apply, capped by the current temperature, then clamp inside the canvas.
    for (let i = 0; i < count; i += 1) {
      const disp = Math.sqrt(dx.get(i) * dx.get(i) + dy.get(i) * dy.get(i)) || 1;
      const limited = Math.min(disp, temperature);
      xs.add(i, (dx.get(i) / disp) * limited);
      ys.add(i, (dy.get(i) / disp) * limited);
      xs.set(i, Math.max(0, Math.min(width, xs.get(i))));
      ys.set(i, Math.max(0, Math.min(height, ys.get(i))));
    }

    temperature = Math.max(0, temperature - cooling);
  }

  // Rescale to fill the viewport with a margin — the simulation's absolute
  // scale is arbitrary, only relative structure matters.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i += 1) {
    if (xs.get(i) < minX) minX = xs.get(i);
    if (xs.get(i) > maxX) maxX = xs.get(i);
    if (ys.get(i) < minY) minY = ys.get(i);
    if (ys.get(i) > maxY) maxY = ys.get(i);
  }
  const margin = 40;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2 - minX * scale;
  const offsetY = (height - spanY * scale) / 2 - minY * scale;

  const positioned: PositionedNode[] = kept.map((node, i) => ({
    ...node,
    x: xs.get(i) * scale + offsetX,
    y: ys.get(i) * scale + offsetY,
    degree: degree.get(node.id) ?? 0,
  }));
  const byId = new Map(positioned.map((n) => [n.id, n]));

  const positionedEdges: PositionedEdge[] = edges
    .map((e): PositionedEdge | null => {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) return null;
      return { ...e, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    })
    .filter((e): e is PositionedEdge => e !== null);

  return { nodes: positioned, edges: positionedEdges, width, height };
}

/** Stable palette for node `type` — same type always gets the same colour. */
const PALETTE = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#ef4444", // red
];

export function colorForType(type: string | undefined): string {
  if (!type) return "#94a3b8"; // slate — untyped
  let hash = 0;
  for (let i = 0; i < type.length; i += 1) hash = (hash * 31 + type.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length] ?? "#94a3b8";
}
