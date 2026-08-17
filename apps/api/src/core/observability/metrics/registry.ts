/**
 * Prometheus metrics registry — zero-dependency hand-rolled implementation.
 *
 * Constellation deliberately prefers zero dependencies in the core. Rather
 * than pulling `prom-client` for the Platform observability tile and then
 * again for tracing, this module owns the ONE place metrics are collected and
 * renders them in the Prometheus text exposition format (v0.0.4) that the
 * compose stack's Prometheus scrapes (see infra/prometheus/prometheus.yml —
 * job `constellation-api`, path `/api/metrics`).
 *
 * Supported metric types:
 *   - Counter   — a monotonic value that only increases (requests, calls, tokens).
 *   - Gauge     — a value that can go up or down (queue depths, uptime).
 *   - Histogram — exact per-bucket counts + sum + total observations
 *                 (latencies), rendered as cumulative `_bucket` series.
 *
 * Everything is process-local (resets on restart), which is correct for a
 * scrape target. Node is single-threaded and each mutation + serialization
 * path is synchronous, so no locking is needed.
 */

export type Label = [string, string];

function labelKey(labels: Label[]): string {
  return labels.map(([k, v]) => `${k}="${v}"`).join(",");
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export interface MetricName {
  name: string;
  unit?: string;
}

export function metricName(name: string, unit: string | undefined): string {
  return unit && unit.length > 0 ? `${name}_${unit}` : name;
}

interface CounterDef extends MetricName {
  help: string;
  values: Map<string, { labels: Label[]; value: number }>;
}

interface GaugeDef extends MetricName {
  help: string;
  values: Map<string, { labels: Label[]; value: number }>;
}

interface HistogramEntry {
  labels: Label[];
  bucketCounts: number[];
  count: number;
  sum: number;
}

interface HistogramHolder {
  def: { name: string; help: string; unit?: string; buckets: number[] };
  entries: Map<string, HistogramEntry>;
}

function renderSample(name: string, labels: Label[], value: number): string {
  const labelStr =
    labels.length > 0
      ? `{${labels.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(",")}}`
      : "";
  const num = Number.isInteger(value) ? String(value) : value.toPrecision(12);
  return `${name}${labelStr} ${num}`;
}

/**
 * The metrics registry. Create one per process and share it via the Nest
 * module. Methods mutate in place; `render()` emits the full text exposition.
 */
export class MetricsRegistry {
  private readonly counters = new Map<string, CounterDef>();
  private readonly gauges = new Map<string, GaugeDef>();
  private readonly histograms = new Map<string, HistogramHolder>();

  /** Declare a counter (idempotent — re-declaration keeps the existing counter). */
  counter(def: { name: string; help: string; unit?: string }): void {
    if (!this.counters.has(def.name)) {
      this.counters.set(def.name, { ...def, values: new Map() });
    }
  }

  /** Declare a gauge (idempotent). */
  gauge(def: { name: string; help: string; unit?: string }): void {
    if (!this.gauges.has(def.name)) {
      this.gauges.set(def.name, { ...def, values: new Map() });
    }
  }

  /** Declare a histogram (idempotent). */
  histogram(def: { name: string; help: string; unit?: string; buckets: number[] }): void {
    if (!this.histograms.has(def.name)) {
      this.histograms.set(def.name, {
        def: { ...def, buckets: [...def.buckets].sort((a, b) => a - b) },
        entries: new Map(),
      });
    }
  }

  /** Increment a counter by `by` (default 1) for the given labels. */
  inc(name: string, labels: Label[], by = 1): void {
    const counter = this.counters.get(name);
    if (!counter) return;
    const key = labelKey(labels);
    const existing = counter.values.get(key);
    if (existing) {
      existing.value += by;
    } else {
      counter.values.set(key, { labels: labels.slice(), value: by });
    }
  }

  /** Set a gauge's absolute value for the given labels. */
  setGauge(name: string, labels: Label[], value: number): void {
    const gauge = this.gauges.get(name);
    if (!gauge) return;
    gauge.values.set(labelKey(labels), { labels: labels.slice(), value });
  }

  /** Add `by` (default 1) to a gauge (convenience for deltas). */
  addGauge(name: string, labels: Label[], by = 1): void {
    const gauge = this.gauges.get(name);
    if (!gauge) return;
    const key = labelKey(labels);
    const existing = gauge.values.get(key);
    if (existing) {
      existing.value += by;
    } else {
      gauge.values.set(key, { labels: labels.slice(), value: by });
    }
  }

  /** Observe one value for a histogram's labels. */
  observe(name: string, labels: Label[], value: number): void {
    const holder = this.histograms.get(name);
    if (!holder) return;
    const key = labelKey(labels);
    let entry = holder.entries.get(key);
    if (!entry) {
      entry = {
        labels: labels.slice(),
        bucketCounts: new Array(holder.def.buckets.length).fill(0),
        count: 0,
        sum: 0,
      };
      holder.entries.set(key, entry);
    }
    entry.count += 1;
    entry.sum += value;
    for (let i = 0; i < holder.def.buckets.length; i++) {
      if (value <= holder.def.buckets[i]!) {
        entry.bucketCounts[i]! += 1;
      }
    }
  }

  /** Render the full text exposition format 0.0.4 (one sample per line). */
  render(): string {
    const lines: string[] = [];
    for (const counter of this.counters.values()) {
      lines.push(`# HELP ${counter.name} ${counter.help}`);
      lines.push(`# TYPE ${counter.name} counter`);
      for (const { labels, value } of counter.values.values()) {
        lines.push(renderSample(metricName(counter.name, counter.unit), labels, value));
      }
    }
    for (const gauge of this.gauges.values()) {
      lines.push(`# HELP ${gauge.name} ${gauge.help}`);
      lines.push(`# TYPE ${gauge.name} gauge`);
      for (const { labels, value } of gauge.values.values()) {
        lines.push(renderSample(metricName(gauge.name, gauge.unit), labels, value));
      }
    }
    for (const { def, entries } of this.histograms.values()) {
      lines.push(`# HELP ${def.name} ${def.help}`);
      lines.push(`# TYPE ${def.name} histogram`);
      const base = metricName(def.name, def.unit);
      for (const entry of entries.values()) {
        let cumulative = 0;
        for (let i = 0; i < def.buckets.length; i++) {
          cumulative += entry.bucketCounts[i]!;
          lines.push(renderSample(`${base}_bucket`, [...entry.labels, ["le", String(def.buckets[i]!)]], cumulative));
        }
        lines.push(renderSample(`${base}_bucket`, [...entry.labels, ["le", "+Inf"]], entry.count));
        lines.push(renderSample(`${base}_sum`, entry.labels, entry.sum));
        lines.push(renderSample(`${base}_count`, entry.labels, entry.count));
      }
    }
    return lines.length > 0 ? lines.join("\n") + "\n" : "";
  }
}
