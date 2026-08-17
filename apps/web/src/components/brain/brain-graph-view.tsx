"use client";

import * as React from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

import { nodeKind, type BrainGraph } from "@/lib/brain";
import { colorForType, forceLayout } from "@/lib/force-layout";
import { Button } from "@/components/ui/button";

/**
 * Force-directed knowledge-graph view (BRAIN.md §6).
 *
 * Pure SVG + a hand-written layout (`lib/force-layout.ts`) — no graph library
 * was added; the portal's dependency set is orchestrator-owned and this needs
 * no d3/canvas runtime. The layout is computed once per graph in a `useMemo`
 * (it's deterministic and synchronous), then rendered declaratively, so there's
 * no animation loop burning frames on a settled graph.
 *
 * Interaction: pan by dragging, zoom with the buttons or the wheel, click a node
 * to select it (which surfaces its detail and dims everything unconnected).
 * `highlightIds` lets the answer panel light up the nodes a claim was grounded in.
 */
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 560;

/** Hub labels only render above this zoom — below it they crowd into mush. */
const LABEL_MIN_ZOOM = 0.9;
/** Minimum distance between two placed label anchors (px in layout space). */
const LABEL_GAP_PX = 46;

export function BrainGraphView({
  graph,
  highlightIds = [],
  onSelectNode,
}: {
  graph: BrainGraph;
  /** Node ids to emphasize — e.g. the provenance of the current answer. */
  highlightIds?: readonly string[];
  onSelectNode?: (nodeId: string | null) => void;
}) {
  // Brain-page UX round: key the layout on CONTENT, not the graph object
  // identity — the parent polls and gets a fresh object each tick; recomputing
  // the O(n²) physics on every poll was the 1200+-node jank. The key changes
  // only when the graph actually changes.
  const graphKey = `${graph.nodes.length}|${graph.edges.length}|${graph.nodes
    .slice(0, 8)
    .map((n) => n.id)
    .join(",")}`;
  const layout = React.useMemo(
    () =>
      forceLayout(
        graph.nodes.map((n) => ({ id: n.id, type: nodeKind(n) })),
        graph.edges.map((e) => ({ source: e.source, target: e.target })),
        { width: VIEW_WIDTH, height: VIEW_HEIGHT },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graphKey],
  );

  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [selected, setSelected] = React.useState<string | null>(null);
  const dragRef = React.useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const highlighted = React.useMemo(() => new Set(highlightIds), [highlightIds]);

  // Neighbours of the selected node — everything else dims so structure reads clearly.
  const neighbours = React.useMemo(() => {
    if (!selected) return null;
    const set = new Set<string>([selected]);
    for (const e of layout.edges) {
      if (e.source === selected) set.add(e.target);
      if (e.target === selected) set.add(e.source);
    }
    return set;
  }, [selected, layout.edges]);

  const nodeById = React.useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const selectedNode = selected ? nodeById.get(selected) ?? null : null;

  function select(id: string | null) {
    setSelected(id);
    onSelectNode?.(id);
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({ x: drag.panX + (event.clientX - drag.x) / zoom, y: drag.panY + (event.clientY - drag.y) / zoom });
  }
  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }
  function handleWheel(event: React.WheelEvent<SVGSVGElement>) {
    setZoom((z) => clampZoom(z * (event.deltaY < 0 ? 1.12 : 0.89)));
  }
  function reset() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    select(null);
  }

  // Distinct node types present, for the legend.
  const legend = React.useMemo(() => {
    const seen = new Map<string, number>();
    for (const n of layout.nodes) {
      const key = n.type ?? "untyped";
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [layout.nodes]);

  const truncated = graph.nodes.length > layout.nodes.length;

  // Brain-page UX round — LABEL ANTI-COLLISION + zoom gating. Compute once
  // which nodes actually get labels: selected/highlighted always win; hub
  // labels (degree >= 4) render only above LABEL_MIN_ZOOM and yield when
  // their anchor lands within LABEL_GAP_PX of an already-placed label, so a
  // dense cluster reads instead of overlapping into one blob.
  const labeledIds = React.useMemo(() => {
    const result = new Set<string>();
    const placed: Array<{ x: number; y: number }> = [];
    const showHubs = zoom >= LABEL_MIN_ZOOM;
    for (const node of layout.nodes) {
      const isSelected = selected === node.id;
      const isHighlighted = highlighted.has(node.id);
      if (!isSelected && !isHighlighted && !(showHubs && node.degree >= 4)) continue;
      if (!isSelected && !isHighlighted) {
        const crowded = placed.some((p) => Math.hypot(p.x - node.x, p.y - node.y) < LABEL_GAP_PX);
        if (crowded) continue;
      }
      placed.push({ x: node.x, y: node.y });
      result.add(node.id);
    }
    return result;
  }, [layout.nodes, zoom, selected, highlighted]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setZoom((z) => clampZoom(z * 1.2))} aria-label="Zoom in">
          <ZoomIn className="size-3.5" />
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setZoom((z) => clampZoom(z / 1.2))} aria-label="Zoom out">
          <ZoomOut className="size-3.5" />
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={reset} aria-label="Reset view">
          <Maximize2 className="size-3.5" /> Reset
        </Button>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {layout.nodes.length} nodes · {layout.edges.length} edges · drag to pan, scroll to zoom
          {truncated ? ` · showing the ${layout.nodes.length} most-connected of ${graph.nodes.length}` : ""}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        {truncated ? (
          <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
            Degraded view — the corpus is too large to lay out at interactive speed, so the{" "}
            {layout.nodes.length} most-connected nodes are shown. Zoom in to read labels; ask a
            question below to work with the full graph.
          </div>
        ) : null}
        <svg
          role="img"
          aria-label={`Knowledge graph with ${layout.nodes.length} nodes and ${layout.edges.length} edges`}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="h-[560px] w-full cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onWheel={handleWheel}
        >
          <g transform={`translate(${VIEW_WIDTH / 2} ${VIEW_HEIGHT / 2}) scale(${zoom}) translate(${-VIEW_WIDTH / 2 + pan.x} ${-VIEW_HEIGHT / 2 + pan.y})`}>
            {layout.edges.map((edge, i) => {
              const dim = neighbours ? !(neighbours.has(edge.source) && neighbours.has(edge.target)) : false;
              return (
                <line
                  key={`${edge.source}->${edge.target}-${i}`}
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                  stroke="currentColor"
                  className="text-neutral-300 dark:text-neutral-700"
                  strokeWidth={1}
                  opacity={dim ? 0.15 : 0.7}
                />
              );
            })}

            {layout.nodes.map((node) => {
              const isHighlighted = highlighted.has(node.id);
              const isSelected = selected === node.id;
              const dim = neighbours ? !neighbours.has(node.id) : false;
              const radius = Math.min(14, 4 + Math.sqrt(node.degree) * 1.8);
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  opacity={dim ? 0.2 : 1}
                  className="cursor-pointer"
                  onClick={(event) => {
                    event.stopPropagation();
                    select(isSelected ? null : node.id);
                  }}
                >
                  <title>{node.id}</title>
                  {isHighlighted ? (
                    <circle r={radius + 6} fill="none" stroke="#f59e0b" strokeWidth={2} opacity={0.9} />
                  ) : null}
                  <circle
                    r={radius}
                    fill={colorForType(node.type)}
                    stroke={isSelected ? "#111827" : "white"}
                    strokeWidth={isSelected ? 2.5 : 1}
                  />
                  {/* Labels only for hubs / highlighted / selected nodes — otherwise the view is unreadable. */}
                  {labeledIds.has(node.id) ? (
                    <text
                      y={radius + 11}
                      textAnchor="middle"
                      className="pointer-events-none fill-neutral-600 text-[9px] dark:fill-neutral-300"
                    >
                      {shortLabel(nodeById.get(node.id)?.label ?? node.id)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-neutral-500 dark:text-neutral-400">
        {legend.map(([type, n]) => (
          <span key={type} className="flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: colorForType(type === "untyped" ? undefined : type) }}
            />
            {type} ({n})
          </span>
        ))}
      </div>

      {selectedNode ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="font-medium text-neutral-800 dark:text-neutral-100">
            {selectedNode.label ?? selectedNode.id}
          </div>
          <dl className="mt-1 grid gap-x-6 gap-y-0.5 text-xs text-neutral-500 sm:grid-cols-2 dark:text-neutral-400">
            <div>
              <dt className="inline font-medium">id: </dt>
              <dd className="inline font-mono break-all">{selectedNode.id}</dd>
            </div>
            {nodeKind(selectedNode) ? (
              <div>
                <dt className="inline font-medium">type: </dt>
                <dd className="inline">{nodeKind(selectedNode)}</dd>
              </div>
            ) : null}
            {selectedNode.path ? (
              <div className="sm:col-span-2">
                <dt className="inline font-medium">source: </dt>
                <dd className="inline font-mono break-all">{selectedNode.path}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function clampZoom(value: number): number {
  return Math.max(0.3, Math.min(4, value));
}

/** Graphify ids are often long paths — show the tail, which is the identifying part. */
function shortLabel(value: string): string {
  const tail = value.split(/[\\/]/).pop() ?? value;
  return tail.length > 22 ? `${tail.slice(0, 21)}…` : tail;
}
