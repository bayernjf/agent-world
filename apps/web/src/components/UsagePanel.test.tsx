import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import UsagePanel, { meterColor } from "./UsagePanel";
import type { SubscriptionStatus } from "../lib/api";

function mkStatus(over: Partial<SubscriptionStatus["usage"]> = {}): SubscriptionStatus {
  return {
    plan: "pro",
    status: "active",
    provider: null,
    currentPeriodStart: "2026-09-01T00:00:00.000Z",
    currentPeriodEnd: "2026-10-01T00:00:00.000Z",
    usage: {
      tokensIn: 0,
      tokensOut: 0,
      tokensNormalized: 0,
      tokensLimit: 2_000_000,
      runs: 0,
      videoSegments: 0,
      videoLimit: 10,
      storageBytes: 0,
      storageLimit: 50 * 1024 ** 3,
      activeRuns: 0,
      concurrentLimit: 5,
      ...over,
    },
  };
}

describe("meterColor thresholds", () => {
  it("is green below 80%, amber 80-99%, red at/over 100%", () => {
    expect(meterColor(0.7)).toBe("var(--ok)");
    expect(meterColor(0.79)).toBe("var(--ok)");
    expect(meterColor(0.8)).toBe("var(--warn)");
    expect(meterColor(0.9)).toBe("var(--warn)");
    expect(meterColor(1)).toBe("var(--alert)");
    expect(meterColor(1.2)).toBe("var(--alert)");
  });
});

describe("UsagePanel", () => {
  it("renders all four meters", () => {
    render(<UsagePanel status={mkStatus()} />);
    expect(screen.getByTestId("usage-tokens")).toBeInTheDocument();
    expect(screen.getByTestId("usage-video")).toBeInTheDocument();
    expect(screen.getByTestId("usage-storage")).toBeInTheDocument();
    expect(screen.getByTestId("usage-concurrency")).toBeInTheDocument();
  });

  it("colors a 70%-used meter green", () => {
    // 1.4M / 2M = 70%
    render(<UsagePanel status={mkStatus({ tokensNormalized: 1_400_000 })} />);
    const fill = screen.getByTestId("usage-tokens-fill");
    expect(fill.style.width).toBe("70%");
    expect(fill.style.background).toBe("var(--ok)");
  });

  it("colors a 90%-used meter amber", () => {
    render(<UsagePanel status={mkStatus({ tokensNormalized: 1_800_000 })} />);
    const fill = screen.getByTestId("usage-tokens-fill");
    expect(fill.style.width).toBe("90%");
    expect(fill.style.background).toBe("var(--warn)");
  });

  it("colors a 100%-used meter red and clamps the fill at 100%", () => {
    render(<UsagePanel status={mkStatus({ tokensNormalized: 2_400_000 })} />);
    const fill = screen.getByTestId("usage-tokens-fill");
    expect(fill.style.width).toBe("100%");
    expect(fill.style.background).toBe("var(--alert)");
  });

  it("renders a zero-limit free dimension as a full muted bar", () => {
    const free = mkStatus({ tokensLimit: 0, tokensNormalized: 123 });
    render(<UsagePanel status={free} />);
    const fill = screen.getByTestId("usage-tokens-fill");
    expect(fill.style.width).toBe("100%");
    expect(fill.style.background).toBe("var(--ink-faint)");
  });
});
