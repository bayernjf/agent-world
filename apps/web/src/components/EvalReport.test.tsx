import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import EvalReport from "./EvalReport";
import type { EvalReport as Report } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: {
    evalReport: vi.fn(),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockEvalReport = api.evalReport as unknown as ReturnType<typeof vi.fn>;

const sampleReport: Report = {
  totals: {
    runs: 20,
    passed: 17,
    passRate: 0.85,
    avgRework: 1.5,
    avgDurationMs: 45000,
    avgScore: 8.5,
  },
  byDay: [
    { day: "2026-09-01", runs: 5, passed: 4, passRate: 0.8, avgRework: 1.2, avgDurationMs: 40000, avgScore: 8.0 },
    { day: "2026-09-02", runs: 7, passed: 6, passRate: 0.857, avgRework: 1.5, avgDurationMs: 45000, avgScore: 8.5 },
    { day: "2026-09-03", runs: 8, passed: 7, passRate: 0.875, avgRework: 1.8, avgDurationMs: 50000, avgScore: 9.0 },
  ],
  byGraph: [
    { graph_id: "g1", graph_name: "测试产线", runs: 12, passed: 10, passRate: 0.833, avgRework: 1.4, avgDurationMs: 42000, avgScore: 8.2 },
    { graph_id: "g2", graph_name: "另一条产线", runs: 8, passed: 7, passRate: 0.875, avgRework: 1.6, avgDurationMs: 48000, avgScore: 8.8 },
  ],
  byPrompt: [
    { graph_id: "g1", graph_name: "测试产线", version: "v1", fingerprint: "fp1", runs: 6, passed: 5, passRate: 0.833, avgRework: 1.3, avgDurationMs: 40000, avgScore: 8.0 },
    { graph_id: "g1", graph_name: "测试产线", version: "v2", fingerprint: "fp2", runs: 6, passed: 5, passRate: 0.833, avgRework: 1.5, avgDurationMs: 44000, avgScore: 8.4 },
  ],
};

function setupMocks(report: Report | null = sampleReport) {
  if (report) {
    mockEvalReport.mockResolvedValue(report);
  } else {
    mockEvalReport.mockResolvedValue(null);
  }
}

function renderModal(open = true, graphId?: string) {
  const onClose = vi.fn();
  render(<EvalReport open={open} onClose={onClose} graphId={graphId} />);
  return { onClose };
}

async function renderAndWait(open = true, graphId?: string) {
  const result = renderModal(open, graphId);
  if (open) {
    await waitFor(() => {
      expect(mockEvalReport).toHaveBeenCalled();
    });
  }
  return result;
}

describe("EvalReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(<EvalReport open={false} onClose={vi.fn()} />);
      expect(container.firstChild).toBeNull();
    });

    it("open=true 时显示标题'质量评估'", async () => {
      await renderAndWait();
      expect(screen.getByText("质量评估")).toBeInTheDocument();
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

    it("显示'导出 CSV'链接", async () => {
      await renderAndWait();
      expect(screen.getByRole("link", { name: "导出 CSV" })).toBeInTheDocument();
    });

    it("默认选中'近 30 天'时间范围", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "近 30 天" })).toHaveClass("is-on");
    });

    it("调用 api.evalReport", async () => {
      await renderAndWait();
      expect(mockEvalReport).toHaveBeenCalled();
    });

    it("传入 graphId 时 api.evalReport 包含 graphId", async () => {
      await renderAndWait(true, "g1");
      expect(mockEvalReport).toHaveBeenCalledWith(
        expect.objectContaining({ graphId: "g1" }),
      );
    });
  });

  describe("加载状态", () => {
    it("加载中显示'加载中…'", () => {
      mockEvalReport.mockReturnValue(new Promise(() => {}));
      renderModal();
      expect(screen.getByText("加载中…")).toBeInTheDocument();
    });

    it("无数据时显示'暂无数据'", async () => {
      mockEvalReport.mockResolvedValue(null);
      await renderAndWait();
      expect(screen.getByText("暂无数据")).toBeInTheDocument();
    });
  });

  describe("评估统计", () => {
    it("显示'合格率'标签和值", async () => {
      await renderAndWait();
      // "合格率"出现在统计标签和趋势标题中
      expect(screen.getAllByText("合格率").length).toBeGreaterThan(0);
      // "85%"可能出现在多处
      expect(screen.getAllByText("85%").length).toBeGreaterThan(0);
    });

    it("显示'运行次数'标签和值", async () => {
      await renderAndWait();
      expect(screen.getByText("运行次数")).toBeInTheDocument();
      expect(screen.getByText("20")).toBeInTheDocument();
    });

    it("显示'通过 / 总数'标签和值", async () => {
      await renderAndWait();
      expect(screen.getByText("通过 / 总数")).toBeInTheDocument();
      expect(screen.getByText("17/20")).toBeInTheDocument();
    });

    it("显示'平均返工'标签", async () => {
      await renderAndWait();
      // "平均返工"出现在统计标签和明细列标题中
      expect(screen.getAllByText("平均返工").length).toBeGreaterThan(0);
    });

    it("显示'平均耗时'标签", async () => {
      await renderAndWait();
      // "平均耗时"出现在统计标签和明细列标题中
      expect(screen.getAllByText("平均耗时").length).toBeGreaterThan(0);
    });

    it("显示'平均质量分'标签和值", async () => {
      await renderAndWait();
      expect(screen.getByText("平均质量分")).toBeInTheDocument();
      expect(screen.getByText("8.5")).toBeInTheDocument();
    });

    it("高合格率(>=90%)使用 good 样式", async () => {
      setupMocks({
        ...sampleReport,
        totals: { ...sampleReport.totals, passRate: 0.95 },
      });
      await renderAndWait();
      const value = screen.getByText("95%");
      expect(value.closest(".cost-stat__value")).toHaveClass("cost-stat__value--good");
    });

    it("中合格率(60-90%)使用 warn 样式", async () => {
      setupMocks({
        ...sampleReport,
        totals: { ...sampleReport.totals, passRate: 0.75 },
      });
      await renderAndWait();
      const value = screen.getByText("75%");
      expect(value.closest(".cost-stat__value")).toHaveClass("cost-stat__value--warn");
    });

    it("低合格率(<60%)使用 bad 样式", async () => {
      setupMocks({
        ...sampleReport,
        totals: { ...sampleReport.totals, passRate: 0.4 },
      });
      await renderAndWait();
      const value = screen.getByText("40%");
      expect(value.closest(".cost-stat__value")).toHaveClass("cost-stat__value--bad");
    });
  });

  describe("每日合格率趋势", () => {
    it("显示'每日合格率趋势'标题", async () => {
      await renderAndWait();
      expect(screen.getByText("每日合格率趋势")).toBeInTheDocument();
    });

    it("显示每日柱状图标签", async () => {
      await renderAndWait();
      // byDay 有 3 天，显示 MM-DD 格式
      expect(screen.getByText("09-01")).toBeInTheDocument();
      expect(screen.getByText("09-02")).toBeInTheDocument();
      expect(screen.getByText("09-03")).toBeInTheDocument();
    });
  });

  describe("时间范围切换", () => {
    it("点击'近 7 天'切换时间范围并重新加载", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "近 7 天" }));
      await waitFor(() => {
        expect(mockEvalReport).toHaveBeenCalledTimes(2);
      });
      expect(screen.getByRole("button", { name: "近 7 天" })).toHaveClass("is-on");
    });

    it("点击'全部'切换时间范围并重新加载", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "全部" }));
      await waitFor(() => {
        expect(mockEvalReport).toHaveBeenCalledTimes(2);
      });
      expect(screen.getByRole("button", { name: "全部" })).toHaveClass("is-on");
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
