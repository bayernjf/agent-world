import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { ContentMetric, PerformanceAggregate, ContentCostAggregate } from "../lib/api";
import PerformanceDashboard from "./PerformanceDashboard";

vi.mock("../lib/api", () => ({
  api: {
    listMetrics: vi.fn(),
    aggregatePerformance: vi.fn(),
    aggregateContentCosts: vi.fn(),
    insertMetric: vi.fn(),
    importMetrics: vi.fn(),
    insertContentCost: vi.fn(),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockListMetrics = api.listMetrics as unknown as ReturnType<typeof vi.fn>;
const mockAggregatePerformance = api.aggregatePerformance as unknown as ReturnType<typeof vi.fn>;
const mockAggregateContentCosts = api.aggregateContentCosts as unknown as ReturnType<typeof vi.fn>;
const mockInsertMetric = api.insertMetric as unknown as ReturnType<typeof vi.fn>;
const mockImportMetrics = api.importMetrics as unknown as ReturnType<typeof vi.fn>;
const mockInsertContentCost = api.insertContentCost as unknown as ReturnType<typeof vi.fn>;

function mkMetric(over: Partial<ContentMetric> = {}): ContentMetric {
  return {
    id: "m-1",
    graphId: "g-1",
    runId: "r-1",
    nodeId: "n-1",
    variant: null,
    artifactId: null,
    productId: null,
    platform: "xiaohongshu",
    externalContentId: "xhs-001",
    impressions: 1000,
    clicks: 100,
    conversions: 10,
    gmv: 500,
    adSpend: 100,
    recordedAt: 1_700_000_000_000,
    ...over,
  };
}

function mkPerfAgg(over: Partial<PerformanceAggregate> = {}): PerformanceAggregate {
  return {
    group: "g-1",
    impressions: 2000,
    clicks: 200,
    conversions: 20,
    gmv: 1000,
    adSpend: 200,
    ...over,
  };
}

function mkCostAgg(over: Partial<ContentCostAggregate> = {}): ContentCostAggregate {
  return {
    group: "a-1",
    costUsd: 0.05,
    gmv: 200,
    roi: 4000,
    ...over,
  };
}

function setupMocks() {
  mockListMetrics.mockResolvedValue([mkMetric()]);
  mockAggregatePerformance.mockResolvedValue([mkPerfAgg()]);
  mockAggregateContentCosts.mockResolvedValue([mkCostAgg()]);
  mockInsertMetric.mockResolvedValue({ ok: true });
  mockImportMetrics.mockResolvedValue({ imported: 2 });
  mockInsertContentCost.mockResolvedValue({ ok: true });
}

async function flush() {
  await act(async () => {});
}

async function renderDashboard(open = true) {
  const onClose = vi.fn();
  render(<PerformanceDashboard open={open} onClose={onClose} />);
  if (open) {
    await waitFor(() => expect(mockListMetrics).toHaveBeenCalled());
    await flush();
  }
  return { onClose };
}

describe("PerformanceDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(<PerformanceDashboard open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders title and summary cards with computed metrics", async () => {
    await renderDashboard();
    expect(screen.getByText("效果数据")).toBeInTheDocument();
    // totals from 1 metric: 1000 impressions, 100 clicks, 10 conversions, 500 gmv, 100 adSpend
    expect(screen.getByText("1,000")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    // CTR = 100/1000 = 10.0%, CVR = 10/100 = 10.0% — both same value
    const pctValues = screen.getAllByText("10.0%");
    expect(pctValues.length).toBe(2);
    expect(screen.getByText("¥500")).toBeInTheDocument();
    expect(screen.getByText("¥100")).toBeInTheDocument();
    // ROI = 500/100 = 5.00 in summary card, also 1000/200 = 5.00 in aggregation table
    const roiValues = screen.getAllByText("5.00");
    expect(roiValues.length).toBeGreaterThanOrEqual(1);
  });

  it("shows dashes for zero-denominator ratios", async () => {
    mockListMetrics.mockResolvedValue([mkMetric({ impressions: 0, clicks: 0, adSpend: 0 })]);
    await renderDashboard();
    // CTR: clicks/impressions = 0/0 → "—"
    // CVR: conversions/clicks = 10/0 → "—"
    // ROI: gmv/adSpend = 500/0 → "—"
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  it("calls aggregatePerformance with selected groupBy", async () => {
    await renderDashboard();
    // default groupBy = graph_id
    expect(mockAggregatePerformance).toHaveBeenCalledWith("graph_id");
    const select = screen.getByLabelText("聚合维度") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "platform" } });
    await flush();
    expect(mockAggregatePerformance).toHaveBeenCalledWith("platform");
  });

  it("renders aggregation table rows", async () => {
    await renderDashboard();
    // group value from mkPerfAgg = "g-1"
    expect(screen.getByText("g-1")).toBeInTheDocument();
    expect(screen.getByText("2,000")).toBeInTheDocument();
  });

  it("inserts a metric and refreshes", async () => {
    await renderDashboard();
    // perf-form comes AFTER perf-costs in JSX, so its "添加" button is index 1
    const platformInputs = screen.getAllByPlaceholderText("平台（可选）");
    fireEvent.change(platformInputs[1], { target: { value: "douyin" } });
    const addButtons = screen.getAllByRole("button", { name: "添加" });
    await act(async () => {
      fireEvent.click(addButtons[1]);
    });
    expect(mockInsertMetric).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "douyin", impressions: 0, clicks: 0, conversions: 0, gmv: 0, adSpend: 0 }),
    );
    expect(mockListMetrics).toHaveBeenCalledTimes(2); // initial + after insert
  });

  it("imports CSV and refreshes", async () => {
    await renderDashboard();
    const csvTextarea = screen.getByPlaceholderText(/impressions,clicks/) as HTMLTextAreaElement;
    fireEvent.change(csvTextarea, { target: { value: "platform,impressions\ndouyin,500" } });
    const importButton = screen.getByText("导入 CSV");
    fireEvent.click(importButton);
    await flush();
    expect(mockImportMetrics).toHaveBeenCalledWith("platform,impressions\ndouyin,500");
    expect(mockListMetrics).toHaveBeenCalledTimes(2);
  });

  it("renders content cost aggregation", async () => {
    await renderDashboard();
    // content cost section
    expect(screen.getByText("内容成本")).toBeInTheDocument();
    expect(screen.getByText("a-1")).toBeInTheDocument();
    expect(screen.getByText("$0.0500")).toBeInTheDocument();
  });

  it("inserts content cost and refreshes", async () => {
    await renderDashboard();
    // perf-costs comes FIRST in JSX, so its "平台（可选）" input is index 0 and "添加" button is index 0
    const platformInputs = screen.getAllByPlaceholderText("平台（可选）");
    fireEvent.change(platformInputs[0], { target: { value: "taobao" } });
    const addButtons = screen.getAllByRole("button", { name: "添加" });
    await act(async () => {
      fireEvent.click(addButtons[0]);
    });
    expect(mockInsertContentCost).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "taobao" }),
    );
  });

  it("closes on Escape", async () => {
    const { onClose } = await renderDashboard();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on backdrop click", async () => {
    const { onClose } = await renderDashboard();
    const backdrop = document.querySelector(".modal-backdrop")!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when clicking modal body", async () => {
    const { onClose } = await renderDashboard();
    const modal = document.querySelector(".modal")!;
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();
  });
});
