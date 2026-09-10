import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { OperationsOverview } from "../lib/api";
import OperationsDashboard from "./OperationsDashboard";

vi.mock("../lib/api", () => ({
  api: {
    operationsOverview: vi.fn(),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockOverview = api.operationsOverview as unknown as ReturnType<typeof vi.fn>;
const NOW = 1_700_000_000_000;

function mkOverview(): OperationsOverview {
  return {
    generatedAt: NOW,
    since: null,
    totals: { totalRuns: 3, running: 0, halted: 1, done: 1, failed: 1, tripped: 0, cancelled: 0, costUsd: 0.0123 },
    graphs: [
      {
        graphId: "g1", graphName: "失败产线", totalRuns: 2, running: 0, halted: 0, done: 1,
        failed: 1, tripped: 0, cancelled: 0, lastRunId: "r2", lastStatus: "failed",
        lastStartedAt: NOW - 60_000, lastEndedAt: NOW - 50_000, costUsd: 0.01,
      },
      {
        graphId: "g2", graphName: "待审产线", totalRuns: 1, running: 0, halted: 1, done: 0,
        failed: 0, tripped: 0, cancelled: 0, lastRunId: "r3", lastStatus: "halted",
        lastStartedAt: NOW - 30_000, lastEndedAt: null, costUsd: 0.0023,
      },
    ],
    nextRuns: {},
  };
}

async function flush() {
  await act(async () => {});
}

async function renderDash(over: Partial<Parameters<typeof OperationsDashboard>[0]> = {}) {
  const onClose = vi.fn();
  const onOpenReviews = vi.fn();
  const onOpenRun = vi.fn();
  render(
    <OperationsDashboard
      open
      onClose={onClose}
      onOpenReviews={onOpenReviews}
      onOpenRun={onOpenRun}
      {...over}
    />,
  );
  await flush();
  return { onClose, onOpenReviews, onOpenRun };
}

describe("OperationsDashboard (RTS phase A4)", () => {
  beforeEach(() => {
    mockOverview.mockReset();
    mockOverview.mockResolvedValue(mkOverview());
  });

  it("renders nothing when closed", () => {
    render(<OperationsDashboard open={false} onClose={vi.fn()} />);
    expect(screen.queryByText("运营工作台")).not.toBeInTheDocument();
  });

  it("renders summary totals and a card per pipeline", async () => {
    await renderDash();
    // failing pipeline shows both as a card and in the attention section
    expect((await screen.findAllByText("失败产线")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("待审产线")).toBeInTheDocument();
    // per-pipeline run counts (the meta line also carries cost, so match by regex)
    expect(screen.getByText(/运行 2 次/)).toBeInTheDocument();
    expect(screen.getByText(/运行 1 次/)).toBeInTheDocument();
    // summary labels are present
    expect(screen.getByText("总运行")).toBeInTheDocument();
    expect(screen.getByText("成功率")).toBeInTheDocument();
  });

  it("lists failed/tripped pipelines in the attention section", async () => {
    await renderDash();
    expect(await screen.findByText("需要关注")).toBeInTheDocument();
    // name appears both as a card and as an attention item
    expect(screen.getAllByText("失败产线").length).toBeGreaterThanOrEqual(2);
  });

  it("switches between today and all-time windows and refetches", async () => {
    await renderDash();
    await waitFor(() => expect(mockOverview).toHaveBeenCalled());
    // initial "today" call carries a since timestamp
    const firstArg = mockOverview.mock.calls[0]![0];
    expect(typeof firstArg).toBe("number");

    mockOverview.mockClear();
    fireEvent.click(screen.getByText("全部"));
    await waitFor(() => expect(mockOverview).toHaveBeenCalledWith(undefined));
  });

  it("opens the review queue via the hub link", async () => {
    const { onOpenReviews } = await renderDash();
    // the halted total (1) rides along as a badge on the review link
    fireEvent.click(screen.getByText("审核队列"));
    expect(onOpenReviews).toHaveBeenCalledOnce();
  });

  it("drills into the latest run from a pipeline card", async () => {
    const { onOpenRun } = await renderDash();
    const buttons = await screen.findAllByText("查看最近运行");
    fireEvent.click(buttons[0]!);
    expect(onOpenRun).toHaveBeenCalled();
  });

  it("shows an empty state when there are no pipelines", async () => {
    mockOverview.mockResolvedValue({
      generatedAt: NOW, since: null,
      totals: { totalRuns: 0, running: 0, halted: 0, done: 0, failed: 0, tripped: 0, cancelled: 0, costUsd: 0 },
      graphs: [], nextRuns: {},
    });
    await renderDash();
    expect(await screen.findByText(/还没有产线/)).toBeInTheDocument();
  });
});
