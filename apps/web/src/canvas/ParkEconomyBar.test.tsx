import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ParkEconomyBar, { fmtCost, fmtTokens } from "./ParkEconomyBar";
import type { OperationsTotals } from "../lib/api";

function makeTotals(partial: Partial<OperationsTotals> = {}): OperationsTotals {
  return {
    totalRuns: 0, running: 0, halted: 0, done: 0, failed: 0, tripped: 0, cancelled: 0,
    costUsd: 0, monthCostUsd: 0, tokensIn: 0, tokensOut: 0, monthlyBudgetUsd: null,
    ...partial,
  };
}

describe("ParkEconomyBar (RTS C4)", () => {
  it("renders nothing when totals are absent", () => {
    const { container } = render(<ParkEconomyBar totals={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows month cost and token throughput without a budget bar when no cap is set", () => {
    render(<ParkEconomyBar totals={makeTotals({ monthCostUsd: 0.1234, tokensIn: 1200, tokensOut: 340 })} />);
    expect(screen.getByTestId("park-economy")).toBeTruthy();
    expect(screen.getByText("$0.1234")).toBeTruthy();
    // 1200 → 1.2k, 340 stays full
    expect(screen.getByText(/1\.2k/)).toBeTruthy();
    expect(screen.getByText(/340/)).toBeTruthy();
    expect(screen.queryByTestId("park-economy-budget")).toBeNull();
  });

  it("renders an ok budget bar under 80% with remaining headroom", () => {
    render(<ParkEconomyBar totals={makeTotals({ monthCostUsd: 2, monthlyBudgetUsd: 10 })} />);
    const budget = screen.getByTestId("park-economy-budget");
    expect(budget.className).toContain("is-ok");
    expect(screen.getByText("20%")).toBeTruthy();
    expect(screen.getByText(/\$8\.0000/)).toBeTruthy();
  });

  it("flags warn at/above 80% and over at/above 100%", () => {
    const { rerender } = render(<ParkEconomyBar totals={makeTotals({ monthCostUsd: 8, monthlyBudgetUsd: 10 })} />);
    expect(screen.getByTestId("park-economy-budget").className).toContain("is-warn");

    rerender(<ParkEconomyBar totals={makeTotals({ monthCostUsd: 12, monthlyBudgetUsd: 10 })} />);
    const over = screen.getByTestId("park-economy-budget");
    expect(over.className).toContain("is-over");
    // bar is clamped to 100% and remaining never goes negative
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByText(/\$0\.0000/)).toBeTruthy();
  });

  it("formats sub-cent cost with six decimals and compact tokens", () => {
    expect(fmtCost(0.001234)).toBe("$0.001234");
    expect(fmtCost(0)).toBe("$0.0000");
    expect(fmtTokens(999)).toBe("999");
    expect(fmtTokens(12_345)).toBe("12.3k");
    expect(fmtTokens(2_400_000)).toBe("2.4M");
  });
});
