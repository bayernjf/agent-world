import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { api, BillingApiError, type SubscriptionStatus } from "../lib/api";
import type { PlanId } from "@agent-world/core";
import { useToast } from "../store/toast";
import BillingTab, { planColumnState, primaryManageAction } from "./BillingTab";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: {
      getSubscription: vi.fn(),
      createCheckoutSession: vi.fn(),
      createPortalSession: vi.fn(),
    },
  };
});
// Keep the test focused on billing actions; children pull their own data.
vi.mock("./UsagePanel", () => ({ default: () => <div data-testid="usage" /> }));
vi.mock("./InvoiceList", () => ({ default: () => <div data-testid="invoices" /> }));

const mockGet = api.getSubscription as unknown as ReturnType<typeof vi.fn>;
const mockCheckout = api.createCheckoutSession as unknown as ReturnType<typeof vi.fn>;
const mockPortal = api.createPortalSession as unknown as ReturnType<typeof vi.fn>;
const assign = vi.fn();

function mkStatus(over: Partial<SubscriptionStatus> = {}): SubscriptionStatus {
  return {
    plan: "free",
    status: "active",
    provider: null,
    currentPeriodStart: 1_725_000_000_000,
    currentPeriodEnd: 1_727_700_000_000,
    usage: {
      tokensIn: 0,
      tokensOut: 0,
      tokensNormalized: 0,
      tokensLimit: 0,
      runs: 0,
      videoSegments: 0,
      videoLimit: 0,
      storageBytes: 0,
      storageLimit: 100 * 1024 ** 2,
      activeRuns: 0,
      concurrentLimit: 1,
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useToast.setState({ toast: null });
  // jsdom forbids real navigation; capture the redirect target instead.
  Object.defineProperty(window, "location", {
    value: { ...window.location, assign },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("planColumnState / primaryManageAction pure matrix", () => {
  it("marks the current column, upgrades only to higher-priced plans", () => {
    expect(planColumnState("pro", { currentPlan: "pro", provider: null, stripeUnavailable: false }).kind).toBe("current");
    expect(planColumnState("team", { currentPlan: "pro", provider: null, stripeUnavailable: false }).kind).toBe("upgrade");
    expect(planColumnState("starter", { currentPlan: "pro", provider: "stripe", stripeUnavailable: false }).kind).toBe("downgrade-in-portal");
    expect(planColumnState("starter", { currentPlan: "pro", provider: "manual", stripeUnavailable: false }).kind).toBe("none");
  });

  it("returns no upgrade column when Stripe is unavailable", () => {
    expect(planColumnState("pro", { currentPlan: "free", provider: null, stripeUnavailable: true }).kind).toBe("none");
  });

  it("maps stripe status to the current-card action", () => {
    expect(primaryManageAction("pro", "stripe", "active", false)).toBe("portal");
    expect(primaryManageAction("pro", "stripe", "past_due", false)).toBe("update-payment");
    expect(primaryManageAction("pro", "stripe", "canceled", false)).toBe("resubscribe");
    expect(primaryManageAction("pro", "manual", "active", false)).toBeNull();
    expect(primaryManageAction("free", null, "active", false)).toBeNull();
    expect(primaryManageAction("pro", "stripe", "active", true)).toBeNull();
  });
});

describe("BillingTab Stripe wiring", () => {
  it("free user sees upgrade buttons for paid plans, no manage button, no contact-owner", async () => {
    mockGet.mockResolvedValue(mkStatus({ plan: "free", provider: null }));
    render(<BillingTab />);
    await screen.findByText("升级到入门版");
    expect(screen.getByText("升级到专业版")).toBeInTheDocument();
    expect(screen.getByText("升级到团队版")).toBeInTheDocument();
    expect(screen.queryByText("管理订阅")).not.toBeInTheDocument();
    expect(screen.queryByText(/联系实例管理员/)).not.toBeInTheDocument();
  });

  it("stripe active subscriber sees Manage subscription which opens the portal", async () => {
    mockGet.mockResolvedValue(mkStatus({ plan: "pro", provider: "stripe", status: "active" }));
    mockPortal.mockResolvedValue({ id: "ps_1", url: "https://billing.stripe/x" });
    render(<BillingTab />);
    const btn = await screen.findByText("管理订阅");
    fireEvent.click(btn);
    await waitFor(() => expect(mockPortal).toHaveBeenCalledOnce());
    expect(assign).toHaveBeenCalledWith("https://billing.stripe/x");
  });

  it("past_due subscriber sees a warning and Update payment method", async () => {
    mockGet.mockResolvedValue(mkStatus({ plan: "pro", provider: "stripe", status: "past_due" }));
    render(<BillingTab />);
    expect(await screen.findByText("订阅待支付")).toBeInTheDocument();
    expect(screen.getByText("更新支付方式")).toBeInTheDocument();
    expect(screen.queryByText("管理订阅")).not.toBeInTheDocument();
  });

  it("manual paid subscriber has no portal button but can upgrade to a higher plan", async () => {
    mockGet.mockResolvedValue(mkStatus({ plan: "pro", provider: "manual", status: "active" }));
    render(<BillingTab />);
    await screen.findByText("升级到团队版");
    expect(screen.queryByText("管理订阅")).not.toBeInTheDocument();
    expect(screen.queryByText("更新支付方式")).not.toBeInTheDocument();
  });

  it("falls back to contact-owner and hides Stripe buttons when checkout returns 503 not-configured", async () => {
    mockGet.mockResolvedValue(mkStatus({ plan: "free", provider: null }));
    mockCheckout.mockRejectedValue(new BillingApiError(503, "stripe_not_configured", "not configured"));
    render(<BillingTab />);
    const upgrade = await screen.findByText("升级到专业版");
    fireEvent.click(upgrade);
    expect(await screen.findByText(/联系实例管理员/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("升级到团队版")).not.toBeInTheDocument());
  });

  it("toasts and re-enables when portal returns 409 no_stripe_customer", async () => {
    mockGet.mockResolvedValue(mkStatus({ plan: "pro", provider: "stripe", status: "active" }));
    mockPortal.mockRejectedValue(new BillingApiError(409, "no_stripe_customer", "no customer"));
    render(<BillingTab />);
    const btn = await screen.findByText("管理订阅");
    fireEvent.click(btn);
    await waitFor(() => expect(useToast.getState().toast?.message).toBe("请先完成一次升级购买后再管理订阅。"));
    // busy cleared → button is back and clickable
    await screen.findByText("管理订阅");
    expect((screen.getByText("管理订阅") as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls checkout with the chosen plan and redirects", async () => {
    mockGet.mockResolvedValue(mkStatus({ plan: "free", provider: null }));
    mockCheckout.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe/y" });
    render(<BillingTab />);
    const upgrade = await screen.findByText("升级到专业版");
    fireEvent.click(upgrade);
    await waitFor(() => expect(mockCheckout).toHaveBeenCalledWith("pro" satisfies PlanId));
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe/y");
  });

  it("shows the current marker on the current column and downgrade hint on a lower stripe column", async () => {
    mockGet.mockResolvedValue(mkStatus({ plan: "pro", provider: "stripe", status: "active" }));
    render(<BillingTab />);
    await screen.findByText("管理订阅");
    // The pro column shows the current marker (there is exactly one in the action row).
    expect(screen.getAllByText("当前套餐").length).toBeGreaterThan(0);
    // free + starter are both lower than pro for a stripe subscriber → downgrade
    // hint on both columns, no checkout button for either.
    expect(screen.getAllByText("更低套餐请在「管理订阅」中更改")).toHaveLength(2);
    expect(screen.queryByText("升级到入门版")).not.toBeInTheDocument();
  });
});
