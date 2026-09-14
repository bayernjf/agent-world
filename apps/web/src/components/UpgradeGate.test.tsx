import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UpgradeGate from "./UpgradeGate";
import { parseQuotaError, useUpgradeGate } from "../store/upgrade-gate";

beforeEach(() => {
  act(() => useUpgradeGate.setState({ block: null }));
});

describe("parseQuotaError", () => {
  it("extracts a structured subscription 402", () => {
    const body = JSON.stringify({
      error: "subscription",
      code: "QUOTA_EXCEEDED",
      metric: "tokens",
      detail: { plan: "free", limit: 0, used: 1234 },
      upgradeUrl: "settings:billing",
      message: "quota",
    });
    const block = parseQuotaError(new Error(`402 ${body}`));
    expect(block).toEqual({ code: "QUOTA_EXCEEDED", metric: "tokens", plan: "free", limit: 0, used: 1234 });
  });

  it("returns null for non-402 errors", () => {
    expect(parseQuotaError(new Error("500 server boom"))).toBeNull();
    expect(parseQuotaError(new Error("network down"))).toBeNull();
  });

  it("returns null for malformed 402 bodies", () => {
    expect(parseQuotaError(new Error("402 not-json"))).toBeNull();
    const other = JSON.stringify({ error: "something-else" });
    expect(parseQuotaError(new Error(`402 ${other}`))).toBeNull();
  });
});

describe("UpgradeGate", () => {
  it("renders nothing when no block is set", () => {
    const { container } = render(
      <UpgradeGate onUpgrade={vi.fn()} onUseCustomModel={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the metric reason and action buttons once opened", () => {
    act(() =>
      useUpgradeGate.getState().open({
        code: "QUOTA_EXCEEDED",
        metric: "tokens",
        plan: "free",
        limit: 0,
        used: 10,
      }),
    );
    render(<UpgradeGate onUpgrade={vi.fn()} onUseCustomModel={vi.fn()} />);
    expect(screen.getByTestId("upgrade-gate")).toBeInTheDocument();
    // zh locale from test setup
    expect(screen.getByText("套餐额度已用尽")).toBeInTheDocument();
    expect(screen.getByText("查看套餐 / 升级")).toBeInTheDocument();
    expect(screen.getByText("改用自定义模型")).toBeInTheDocument();
  });

  it("hides the BYOK button for storage/concurrency blocks", () => {
    act(() =>
      useUpgradeGate.getState().open({
        code: "CONCURRENCY_EXCEEDED",
        metric: "concurrency",
        plan: "free",
        limit: 1,
        used: 1,
      }),
    );
    render(<UpgradeGate onUpgrade={vi.fn()} onUseCustomModel={vi.fn()} />);
    expect(screen.queryByText("改用自定义模型")).toBeNull();
  });

  it("calls onUpgrade and closes when the upgrade button is clicked", () => {
    const onUpgrade = vi.fn();
    act(() =>
      useUpgradeGate.getState().open({
        code: "QUOTA_EXCEEDED",
        metric: "tokens",
        plan: "free",
        limit: 0,
        used: 10,
      }),
    );
    render(<UpgradeGate onUpgrade={onUpgrade} onUseCustomModel={vi.fn()} />);
    fireEvent.click(screen.getByText("查看套餐 / 升级"));
    expect(onUpgrade).toHaveBeenCalledOnce();
    expect(useUpgradeGate.getState().block).toBeNull();
  });
});
