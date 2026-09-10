import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { BatchJob, BatchItem } from "../lib/api";
import BatchManager from "./BatchManager";

vi.mock("../lib/api", () => ({
  api: {
    listBatches: vi.fn(),
    getBatch: vi.fn(),
    createBatch: vi.fn(),
    retryBatchItem: vi.fn(),
    listGraphs: vi.fn(),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockListBatches = api.listBatches as unknown as ReturnType<typeof vi.fn>;
const mockGetBatch = api.getBatch as unknown as ReturnType<typeof vi.fn>;
const mockCreateBatch = api.createBatch as unknown as ReturnType<typeof vi.fn>;
const mockRetryBatchItem = api.retryBatchItem as unknown as ReturnType<typeof vi.fn>;
const mockListGraphs = api.listGraphs as unknown as ReturnType<typeof vi.fn>;

const NOW = 1_700_000_000_000;

function mkBatch(over: Partial<BatchJob> = {}): BatchJob {
  return {
    id: "b-1",
    graphId: "g-1",
    status: "running",
    total: 3,
    succeeded: 1,
    failed: 1,
    sourceName: null,
    createdAt: NOW,
    finishedAt: null,
    ...over,
  };
}

function mkItem(over: Partial<BatchItem> = {}): BatchItem {
  return {
    id: "i-1",
    batchId: "b-1",
    rowIndex: 0,
    input: { name: "商品A", title: "标题A" },
    runId: "r-1",
    status: "done",
    outputSummary: null,
    artifactIds: [],
    error: null,
    ...over,
  };
}

function setupMocks() {
  mockListBatches.mockResolvedValue([mkBatch()]);
  mockGetBatch.mockResolvedValue({ ...mkBatch(), items: [mkItem(), mkItem({ id: "i-2", rowIndex: 1, status: "failed", error: "429 rate limit" })] });
  mockCreateBatch.mockResolvedValue({ batchId: "b-new" });
  mockRetryBatchItem.mockResolvedValue({ ok: true });
  mockListGraphs.mockResolvedValue([{ id: "g-1", name: "文案产线", updated_at: NOW, sharedRole: null }]);
}

async function flush() {
  await act(async () => {});
}

async function renderManager(open = true) {
  const onClose = vi.fn();
  render(<BatchManager open={open} onClose={onClose} />);
  if (open) {
    await waitFor(() => expect(mockListBatches).toHaveBeenCalled());
    await flush();
  }
  return { onClose };
}

describe("BatchManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(<BatchManager open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders title and hint", async () => {
    await renderManager();
    expect(screen.getByText("批量任务")).toBeInTheDocument();
    expect(screen.getByText(/一份清单批量跑产线/)).toBeInTheDocument();
  });

  it("shows empty state when no batches", async () => {
    mockListBatches.mockResolvedValue([]);
    await renderManager();
    expect(screen.getByText("暂无批次，先在上方粘贴清单创建。")).toBeInTheDocument();
  });

  it("renders batch list with status and progress", async () => {
    await renderManager();
    // status badge
    expect(screen.getByText("运行中")).toBeInTheDocument();
    // progress text
    expect(screen.getByText("成功 1 / 失败 1 / 共 3")).toBeInTheDocument();
  });

  it("shows error when creating without graph", async () => {
    await renderManager();
    const csvTextarea = screen.getByPlaceholderText(/name,title/) as HTMLTextAreaElement;
    fireEvent.change(csvTextarea, { target: { value: "name,title\nA,B" } });
    fireEvent.click(screen.getByText("创建批次"));
    await flush();
    expect(screen.getByText("请先选择目标产线")).toBeInTheDocument();
    expect(mockCreateBatch).not.toHaveBeenCalled();
  });

  it("shows error when creating with empty CSV", async () => {
    await renderManager();
    const select = screen.getByDisplayValue("选择产线") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "g-1" } });
    fireEvent.click(screen.getByText("创建批次"));
    await flush();
    expect(screen.getByText("请粘贴批量清单（CSV）")).toBeInTheDocument();
    expect(mockCreateBatch).not.toHaveBeenCalled();
  });

  it("creates a batch and expands it", async () => {
    await renderManager();
    const select = screen.getByDisplayValue("选择产线") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "g-1" } });
    const csvTextarea = screen.getByPlaceholderText(/name,title/) as HTMLTextAreaElement;
    fireEvent.change(csvTextarea, { target: { value: "name,title\nA,B\nC,D" } });
    fireEvent.click(screen.getByText("创建批次"));
    await flush();
    expect(mockCreateBatch).toHaveBeenCalledWith(
      expect.objectContaining({ graphId: "g-1", csv: "name,title\nA,B\nC,D", concurrency: 2 }),
    );
    // after create, expanded = new batch id, getBatch called
    expect(mockGetBatch).toHaveBeenCalledWith("b-new");
  });

  it("expands batch and shows items table", async () => {
    await renderManager();
    // click batch row to expand
    fireEvent.click(screen.getByText("成功 1 / 失败 1 / 共 3"));
    await flush();
    expect(mockGetBatch).toHaveBeenCalledWith("b-1");
    await flush();
    // items table visible
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("成功")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText(/429 rate limit/)).toBeInTheDocument();
  });

  it("retries a failed item", async () => {
    await renderManager();
    fireEvent.click(screen.getByText("成功 1 / 失败 1 / 共 3"));
    await flush();
    await flush();
    // find retry button (only failed items have it)
    const retryButtons = screen.getAllByText("重跑");
    expect(retryButtons.length).toBe(1);
    fireEvent.click(retryButtons[0]);
    await flush();
    expect(mockRetryBatchItem).toHaveBeenCalledWith("b-1", "i-2");
  });

  it("closes on Escape", async () => {
    const { onClose } = await renderManager();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on backdrop click", async () => {
    const { onClose } = await renderManager();
    const backdrop = document.querySelector(".modal-backdrop")!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when clicking modal body", async () => {
    const { onClose } = await renderManager();
    const modal = document.querySelector(".modal")!;
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders different status badges", async () => {
    mockListBatches.mockResolvedValue([
      mkBatch({ id: "b-done", status: "done", succeeded: 3, failed: 0 }),
      mkBatch({ id: "b-failed", status: "failed", succeeded: 0, failed: 3 }),
      mkBatch({ id: "b-partial", status: "partial", succeeded: 2, failed: 1 }),
    ]);
    await renderManager();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("部分失败")).toBeInTheDocument();
  });
});
