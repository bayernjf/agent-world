import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import CostReport from "./CostReport";
import type { CostReport as Report } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: {
    costReport: vi.fn(),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockCostReport = api.costReport as unknown as ReturnType<typeof vi.fn>;

const sampleReport: Report = {
  totals: {
    cost_usd: 0.12345,
    runs: 10,
    tokens_in: 15000,
    tokens_out: 3000,
    cached_tokens: 5000,
    reasoning_tokens: 1000,
  },
  byDay: [
    { day: "2026-09-01", cost_usd: 0.05, runs: 3, tokens_in: 5000, tokens_out: 1000 },
    { day: "2026-09-02", cost_usd: 0.07, runs: 4, tokens_in: 7000, tokens_out: 1500 },
    { day: "2026-09-03", cost_usd: 0.00345, runs: 3, tokens_in: 3000, tokens_out: 500 },
  ],
  byWeek: [
    { week: "2026-W35", cost_usd: 0.12345, runs: 10, tokens_in: 15000, tokens_out: 3000 },
  ],
  byMonth: [
    { month: "2026-09", cost_usd: 0.12345, runs: 10, tokens_in: 15000, tokens_out: 3000 },
  ],
  byGraph: [
    { graph_id: "g1", graph_name: "测试产线", cost_usd: 0.08, runs: 6, tokens_in: 10000, tokens_out: 2000 },
    { graph_id: "g2", graph_name: "另一条产线", cost_usd: 0.04345, runs: 4, tokens_in: 5000, tokens_out: 1000 },
  ],
  byNode: [
    { graph_id: "g1", graph_name: "测试产线", node_id: "n1", node_name: "文坊1", cost_usd: 0.05, tokens_in: 6000, tokens_out: 1200, attempts: 6, reworks: 1 },
    { graph_id: "g1", graph_name: "测试产线", node_id: "n2", node_name: "质检站", cost_usd: 0.03, tokens_in: 4000, tokens_out: 800, attempts: 6, reworks: 0 },
  ],
  byModel: [
    { model: "gpt-4o", cost_usd: 0.1, runs: 8 },
    { model: "dall-e-3", cost_usd: 0.02345, runs: 2 },
  ],
  byAttempt: [
    { attempt: 1, calls: 10, cost_usd: 0.1, tokens_in: 12000, tokens_out: 2500 },
    { attempt: 2, calls: 3, cost_usd: 0.02345, tokens_in: 3000, tokens_out: 500 },
  ],
};

function setupMocks(report: Report | null = sampleReport) {
  if (report) {
    mockCostReport.mockResolvedValue(report);
  } else {
    mockCostReport.mockResolvedValue({
      totals: { cost_usd: 0, runs: 0, tokens_in: 0, tokens_out: 0, cached_tokens: 0, reasoning_tokens: 0 },
      byDay: [],
      byWeek: [],
      byMonth: [],
      byGraph: [],
      byNode: [],
      byAttempt: [],
    });
  }
}

function renderModal(open = true) {
  const onClose = vi.fn();
  render(<CostReport open={open} onClose={onClose} />);
  return { onClose };
}

async function renderAndWait(open = true) {
  const result = renderModal(open);
  if (open) {
    await waitFor(() => {
      expect(mockCostReport).toHaveBeenCalled();
    });
  }
  return result;
}

describe("CostReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(<CostReport open={false} onClose={vi.fn()} />);
      expect(container.firstChild).toBeNull();
    });

    it("open=true 时显示标题'成本报表'", async () => {
      await renderAndWait();
      expect(screen.getByText("成本报表")).toBeInTheDocument();
    });

    it("显示关闭按钮", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "✕" })).toBeInTheDocument();
    });

    it("显示时间范围选择按钮（近7天/近30天/全部）", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "近 7 天" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "近 30 天" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "全部" })).toBeInTheDocument();
    });

    it("显示粒度选择按钮（日/周/月）", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "日" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "周" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "月" })).toBeInTheDocument();
    });

    it("显示'导出 CSV'链接", async () => {
      await renderAndWait();
      expect(screen.getByRole("link", { name: "导出 CSV" })).toBeInTheDocument();
    });

    it("默认选中'近 30 天'时间范围", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "近 30 天" })).toHaveClass("is-on");
    });

    it("默认选中'周'粒度（近30天对应周）", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "周" })).toHaveClass("is-on");
    });

    it("调用 api.costReport", async () => {
      await renderAndWait();
      expect(mockCostReport).toHaveBeenCalled();
    });
  });

  describe("加载状态", () => {
    it("加载中显示'加载中…'", () => {
      // mock 不 resolve，保持 loading 状态
      mockCostReport.mockReturnValue(new Promise(() => {}));
      renderModal();
      expect(screen.getByText("加载中…")).toBeInTheDocument();
    });

    it("无数据时显示'暂无数据'", async () => {
      // api 返回 null，组件会显示"暂无数据"
      mockCostReport.mockResolvedValue(null);
      await renderAndWait();
      expect(screen.getByText("暂无数据")).toBeInTheDocument();
    });
  });

  describe("成本统计", () => {
    it("显示'总电费'标签和值", async () => {
      await renderAndWait();
      expect(screen.getByText("总电费")).toBeInTheDocument();
      expect(screen.getByText("$0.12345")).toBeInTheDocument();
    });

    it("显示'运行次数'标签和值", async () => {
      await renderAndWait();
      expect(screen.getByText("运行次数")).toBeInTheDocument();
      expect(screen.getByText("10")).toBeInTheDocument();
    });

    it("显示'输入 token'标签和值", async () => {
      await renderAndWait();
      expect(screen.getByText("输入 token")).toBeInTheDocument();
      expect(screen.getByText("15,000")).toBeInTheDocument();
    });

    it("显示'输出 token'标签和值", async () => {
      await renderAndWait();
      expect(screen.getByText("输出 token")).toBeInTheDocument();
      expect(screen.getByText("3,000")).toBeInTheDocument();
    });

    it("显示'缓存命中'标签和值", async () => {
      await renderAndWait();
      expect(screen.getByText("缓存命中")).toBeInTheDocument();
      // 5,000 可能在多处出现，用 getAllByText 验证存在
      expect(screen.getAllByText("5,000").length).toBeGreaterThan(0);
    });

    it("显示'返工电费'标签和值", async () => {
      await renderAndWait();
      expect(screen.getByText("返工电费")).toBeInTheDocument();
      // attempt > 1 的成本：0.02345
      expect(screen.getByText("$0.02345")).toBeInTheDocument();
    });
  });

  describe("时间范围切换", () => {
    it("点击'近 7 天'切换时间范围并重新加载", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "近 7 天" }));
      await waitFor(() => {
        expect(mockCostReport).toHaveBeenCalledTimes(2);
      });
      expect(screen.getByRole("button", { name: "近 7 天" })).toHaveClass("is-on");
    });

    it("点击'近 7 天'后粒度自动切换为'日'", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "近 7 天" }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "日" })).toHaveClass("is-on");
      });
    });

    it("点击'全部'切换时间范围并重新加载", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "全部" }));
      await waitFor(() => {
        expect(mockCostReport).toHaveBeenCalledTimes(2);
      });
      expect(screen.getByRole("button", { name: "全部" })).toHaveClass("is-on");
    });

    it("点击'全部'后粒度自动切换为'月'", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "全部" }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "月" })).toHaveClass("is-on");
      });
    });
  });

  describe("粒度切换", () => {
    it("点击'日'切换粒度", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "日" }));
      expect(screen.getByRole("button", { name: "日" })).toHaveClass("is-on");
    });

    it("点击'月'切换粒度", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "月" }));
      expect(screen.getByRole("button", { name: "月" })).toHaveClass("is-on");
    });
  });

  describe("关闭", () => {
    it("点击关闭按钮调用 onClose", async () => {
      const { onClose } = await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "✕" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击背景调用 onClose", async () => {
      const { onClose } = await renderAndWait();
      const backdrop = document.querySelector(".modal-backdrop")!;
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击模态框内容不调用 onClose", async () => {
      const { onClose } = await renderAndWait();
      const modal = document.querySelector(".modal")!;
      fireEvent.click(modal);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("按 Escape 键调用 onClose", async () => {
      const { onClose } = await renderAndWait();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
