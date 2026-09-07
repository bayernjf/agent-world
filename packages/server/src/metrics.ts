/**
 * In-process RED + business metrics, exposed in Prometheus text format.
 *
 * Zero-dependency by design: single-instance self-hosting aggregates in memory
 * (mirroring `rate-limit.ts`), so we deliberately avoid prom-client's full
 * feature set. Counters/gauges/histograms are the only shapes we need to
 * answer "how much / how fast / how many failed" for a cost-sensitive product.
 *
 * Histogram buckets are cumulative (each bucket counts samples <= its upper
 * bound), matching the Prometheus exposition format.
 */

type Labels = Record<string, string>;

export interface Counter {
  inc(labels?: Labels, by?: number): void;
}

export interface Gauge {
  set(value: number, labels?: Labels): void;
  inc(labels?: Labels, by?: number): void;
  dec(labels?: Labels, by?: number): void;
}

export interface Histogram {
  observe(value: number, labels?: Labels): void;
}

type MetricType = "counter" | "gauge" | "histogram";

interface HistogramState {
  /** Cumulative counts per bucket: index i = samples <= buckets[i]. */
  counts: number[];
  sum: number;
  count: number;
}

interface Family {
  name: string;
  help: string;
  type: MetricType;
  values: Map<string, number>; // counter / gauge: labelKey -> value
  histograms: Map<string, HistogramState>; // histogram: labelKey -> state
  buckets: number[];
}

const families = new Map<string, Family>();

/** Stable, sorted label set in Prometheus `{k="v"}` form — also the map key. */
function labelKey(labels: Labels = {}): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "";
  return "{" + entries.map(([k, v]) => `${k}="${v}"`).join(",") + "}";
}

function family(name: string, help: string, type: MetricType, buckets: number[] = []): Family {
  let f = families.get(name);
  if (!f) {
    f = { name, help, type, values: new Map(), histograms: new Map(), buckets };
    families.set(name, f);
  }
  return f;
}

export function counter(name: string, help: string): Counter {
  const f = family(name, help, "counter");
  return {
    inc(labels = {}, by = 1) {
      const k = labelKey(labels);
      f.values.set(k, (f.values.get(k) ?? 0) + by);
    },
  };
}

export function gauge(name: string, help: string): Gauge {
  const f = family(name, help, "gauge");
  return {
    set(value, labels = {}) {
      f.values.set(labelKey(labels), value);
    },
    inc(labels = {}, by = 1) {
      const k = labelKey(labels);
      f.values.set(k, (f.values.get(k) ?? 0) + by);
    },
    dec(labels = {}, by = 1) {
      const k = labelKey(labels);
      f.values.set(k, (f.values.get(k) ?? 0) - by);
    },
  };
}

export function histogram(name: string, help: string, buckets: number[]): Histogram {
  const f = family(name, help, "histogram", buckets);
  return {
    observe(value, labels = {}) {
      const k = labelKey(labels);
      let h = f.histograms.get(k);
      if (!h) {
        h = { counts: buckets.map(() => 0), sum: 0, count: 0 };
        f.histograms.set(k, h);
      }
      for (let i = 0; i < buckets.length; i++) {
        if (value <= buckets[i]!) h.counts[i] = (h.counts[i] ?? 0) + 1;
      }
      h.sum += value;
      h.count += 1;
    },
  };
}

/** Renders all families in the Prometheus text exposition format. */
export function renderMetrics(): string {
  const lines: string[] = [];
  for (const f of families.values()) {
    lines.push(`# HELP ${f.name} ${f.help}`);
    lines.push(`# TYPE ${f.name} ${f.type}`);
    if (f.type === "histogram") {
      for (const [k, h] of f.histograms) {
        const base = f.name + k;
        for (let i = 0; i < f.buckets.length; i++) {
          lines.push(`${base}_bucket{le="${f.buckets[i]}"} ${h.counts[i]}`);
        }
        lines.push(`${base}_bucket{le="+Inf"} ${h.count}`);
        lines.push(`${base}_sum ${h.sum}`);
        lines.push(`${base}_count ${h.count}`);
      }
    } else {
      for (const [k, v] of f.values) {
        lines.push(`${f.name}${k} ${v}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

/** Clears all metrics — used only by tests to reset shared state. */
export function resetMetrics(): void {
  families.clear();
}
