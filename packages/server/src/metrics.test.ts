import { afterEach, describe, expect, it } from "vitest";
import { counter, gauge, histogram, renderMetrics, resetMetrics } from "./metrics.js";

afterEach(() => resetMetrics());

describe("metrics (in-process Prometheus exposition)", () => {
  it("counter increments per label set and renders", () => {
    const c = counter("http_requests_total", "HTTP requests");
    c.inc({ method: "GET", status: "200" });
    c.inc({ method: "GET", status: "200" });
    c.inc({ method: "POST", status: "500" });
    const out = renderMetrics();
    expect(out).toContain("# HELP http_requests_total HTTP requests");
    expect(out).toContain("# TYPE http_requests_total counter");
    expect(out).toContain('http_requests_total{method="GET",status="200"} 2');
    expect(out).toContain('http_requests_total{method="POST",status="500"} 1');
  });

  it("gauge supports set / inc / dec", () => {
    const g = gauge("runs_active", "Active runs");
    g.inc();
    g.inc();
    g.dec();
    expect(renderMetrics()).toContain("runs_active 1");
    g.set(5);
    expect(renderMetrics()).toContain("runs_active 5");
  });

  it("histogram accumulates cumulative buckets plus sum/count", () => {
    const h = histogram("http_request_duration_ms", "Latency", [10, 50, 100]);
    h.observe(5);
    h.observe(20);
    h.observe(200);
    const out = renderMetrics();
    // cumulative: <=10 has 1 sample, <=50 has 2, <=100 has 2, +Inf has all 3.
    expect(out).toContain('http_request_duration_ms_bucket{le="10"} 1');
    expect(out).toContain('http_request_duration_ms_bucket{le="50"} 2');
    expect(out).toContain('http_request_duration_ms_bucket{le="100"} 2');
    expect(out).toContain('http_request_duration_ms_bucket{le="+Inf"} 3');
    expect(out).toContain("http_request_duration_ms_sum 225");
    expect(out).toContain("http_request_duration_ms_count 3");
  });

  it("reset clears all families", () => {
    counter("x_total", "x").inc();
    expect(renderMetrics()).toContain("x_total");
    resetMetrics();
    expect(renderMetrics()).toBe("\n");
  });
});
