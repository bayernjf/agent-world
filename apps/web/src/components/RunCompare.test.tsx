import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import RunCompare from "./RunCompare";

const mockRuns = [
  { id: "run-1", graph_id: "graph-1", graph_name: "测试产线", status: "success", trigger: "manual", budget_usd: null, started_at: 1725000000000, ended_at: 1725000600000 },
  { id: "run-2", graph_id: "graph-1", graph_name: "测试产线", status: "success", trigger: "manual", budget_usd: null, started_at: 1725001000000, ended_at: 1725001600000 },
  { id: "run-3", graph_id: "graph-1", graph_name: "测试产线", status: "failed", trigger: "scheduled", budget_usd: 10, started_at: 1725002000000, ended_at: null },
];

const mockStatsA = { nodes: 3, tokens_in: 1000, tokens_out: 500, cost_usd: 0.0123 };
const mockStatsB = { nodes: 4, tokens_in: 1500, tokens_out: 800, cost_usd: 0.0256 };

const mockEventsA = {
  events: [
    { type: "node.finished", nodeId: "node-1", output: "输出 A1\n第二行\n第三行" },
    { type: "node.finished", nodeId: "node-2", output: "输出 A2" },
  ],
};

const mockEventsB = {
  events: [
    { type: "node.finished", nodeId: "node-1", output: "输出 A1\n第二行\n新行B" },
    { type: "node.finished", nodeId: "node-2", output: "输出 B2 不同" },
    { type: "node.finished", nodeId: "node-3", output: "仅 B 有输出" },
  ],
};

function mockFetch(url: string) {
  if (url.includes("/api/runs?graphId")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ runs: mockRuns }) });
  }
  if (url.includes("/stats")) {
    const runId = url.includes("run-1") ? "run-1" : "run-2";
    const stats = runId === "run-1" ? mockStatsA : mockStatsB;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(stats) });
  }
  if (url.includes("/events")) {
    const runId = url.includes("run-1") ? "run-1" : "run-2";
    const events = runId === "run-1" ? mockEventsA : mockEventsB;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(events) });
  }
  return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
}

function renderComponent(overrides: Partial<{
  open: boolean;
  graphId: string;
  onClose: () => void;
}> = {}) {
  const onClose = vi.fn();
  render(
    <RunCompare
      open={overrides.open ?? true}
      graphId={overrides.graphId ?? "graph-1"}
      onClose={overrides.onClose ?? onClose}
    />,
  );
  return { onClose: overrides.onClose ?? onClose };
}

describe("RunCompare", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    global.fetch = vi.fn(mockFetch) as any;
    global.alert = vi.fn();
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(
        <RunCompare open={false} graphId="graph-1" onClose={vi.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("显示'运行对比'标题", () => {
      renderComponent();
      expect(screen.getByText("运行对比")).toBeInTheDocument();
    });

    it("显示关闭按钮", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
    });

    it("显示运行 A 标签", () => {
      renderComponent();
      expect(screen.getByText("运行 A")).toBeInTheDocument();
    });

    it("显示运行 B 标签", () => {
      renderComponent();
      expect(screen.getByText("运行 B")).toBeInTheDocument();
    });

    it("显示'开始对比'按钮", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "开始对比" })).toBeInTheDocument();
    });

    it("有 modal-overlay class", () => {
      renderComponent();
      expect(document.querySelector(".modal-overlay")).toBeInTheDocument();
    });

    it("有 run-compare class", () => {
      renderComponent();
      expect(document.querySelector(".run-compare")).toBeInTheDocument();
    });

    it("有 run-compare__selectors class", () => {
      renderComponent();
      expect(document.querySelector(".run-compare__selectors")).toBeInTheDocument();
    });
  });

  describe("运行列表加载", () => {
    it("打开时调用 fetch 加载运行列表", async () => {
      renderComponent();
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith("/api/runs?graphId=graph-1&limit=50");
      });
    });

    it("运行 A 下拉框显示所有运行", async () => {
      renderComponent();
      await waitFor(() => {
        const selects = screen.getAllByRole("combobox");
        const optionsA = selects[0].querySelectorAll("option");
        expect(optionsA.length).toBe(4); // 1 placeholder + 3 runs
      });
    });

    it("运行 B 下拉框显示所有运行", async () => {
      renderComponent();
      await waitFor(() => {
        const selects = screen.getAllByRole("combobox");
        const optionsB = selects[1].querySelectorAll("option");
        expect(optionsB.length).toBe(4);
      });
    });

    it("下拉框有'选择运行...'占位符", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getAllByText("选择运行...").length).toBe(2);
      });
    });

    it("加载失败时运行列表为空", async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error("网络错误"));
      renderComponent();
      await waitFor(() => {
        const selects = screen.getAllByRole("combobox");
        const optionsA = selects[0].querySelectorAll("option");
        expect(optionsA.length).toBe(1); // only placeholder
      });
    });
  });

  describe("对比按钮状态", () => {
    it("未选择运行时按钮禁用", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "开始对比" })).toBeDisabled();
    });

    it("只选择运行 A 时按钮禁用", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getAllByRole("combobox")[0].querySelectorAll("option").length).toBe(4);
      });
      const selects = screen.getAllByRole("combobox");
      fireEvent.change(selects[0], { target: { value: "run-1" } });
      expect(screen.getByRole("button", { name: "开始对比" })).toBeDisabled();
    });

    it("只选择运行 B 时按钮禁用", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getAllByRole("combobox")[0].querySelectorAll("option").length).toBe(4);
      });
      const selects = screen.getAllByRole("combobox");
      fireEvent.change(selects[1], { target: { value: "run-2" } });
      expect(screen.getByRole("button", { name: "开始对比" })).toBeDisabled();
    });

    it("选择两个运行后按钮启用", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getAllByRole("combobox")[0].querySelectorAll("option").length).toBe(4);
      });
      const selects = screen.getAllByRole("combobox");
      fireEvent.change(selects[0], { target: { value: "run-1" } });
      fireEvent.change(selects[1], { target: { value: "run-2" } });
      expect(screen.getByRole("button", { name: "开始对比" })).not.toBeDisabled();
    });
  });

  describe("对比", () => {
    beforeEach(async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getAllByRole("combobox")[0].querySelectorAll("option").length).toBe(4);
      });
      const selects = screen.getAllByRole("combobox");
      fireEvent.change(selects[0], { target: { value: "run-1" } });
      fireEvent.change(selects[1], { target: { value: "run-2" } });
    });

    it("点击开始对比调用 fetch 获取统计", async () => {
      fireEvent.click(screen.getByRole("button", { name: "开始对比" }));
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/stats");
        expect(fetch).toHaveBeenCalledWith("/api/runs/run-2/stats");
      });
    });

    it("点击开始对比调用 fetch 获取事件", async () => {
      fireEvent.click(screen.getByRole("button", { name: "开始对比" }));
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith("/api/runs/run-1/events");
        expect(fetch).toHaveBeenCalledWith("/api/runs/run-2/events");
      });
    });

    it("对比中显示'对比中...'", async () => {
      (global.fetch as any).mockImplementation((url: string) => {
        if (url.includes("/stats") || url.includes("/events")) {
          return new Promise(() => {});
        }
        return mockFetch(url);
      });
      fireEvent.click(screen.getByRole("button", { name: "开始对比" }));
      await waitFor(() => {
        expect(screen.getByText("对比中...")).toBeInTheDocument();
      });
    });

    it("对比中按钮禁用", async () => {
      (global.fetch as any).mockImplementation((url: string) => {
        if (url.includes("/stats") || url.includes("/events")) {
          return new Promise(() => {});
        }
        return mockFetch(url);
      });
      fireEvent.click(screen.getByRole("button", { name: "开始对比" }));
      await waitFor(() => {
        expect(screen.getByText("对比中...")).toBeDisabled();
      });
    });

    it("对比失败调用 alert", async () => {
      (global.fetch as any).mockImplementation((url: string) => {
        if (url.includes("/stats")) {
          return Promise.reject(new Error("获取统计失败"));
        }
        return mockFetch(url);
      });
      fireEvent.click(screen.getByRole("button", { name: "开始对比" }));
      await waitFor(() => {
        expect(alert).toHaveBeenCalledWith(expect.stringContaining("对比失败"));
      });
    });
  });

  describe("成本与用量对比", () => {
    beforeEach(async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getAllByRole("combobox")[0].querySelectorAll("option").length).toBe(4);
      });
      const selects = screen.getAllByRole("combobox");
      fireEvent.change(selects[0], { target: { value: "run-1" } });
      fireEvent.change(selects[1], { target: { value: "run-2" } });
      fireEvent.click(screen.getByRole("button", { name: "开始对比" }));
      await waitFor(() => {
        expect(screen.getByText("成本与用量对比")).toBeInTheDocument();
      });
    });

    it("显示'成本与用量对比'标题", () => {
      expect(screen.getByText("成本与用量对比")).toBeInTheDocument();
    });

    it("有 compare-table class", () => {
      expect(document.querySelector(".compare-table")).toBeInTheDocument();
    });

    it("显示总成本", () => {
      expect(screen.getByText("总成本 (USD)")).toBeInTheDocument();
    });

    it("显示运行 A 总成本", () => {
      expect(screen.getByText("$0.0123")).toBeInTheDocument();
    });

    it("显示运行 B 总成本", () => {
      expect(screen.getByText("$0.0256")).toBeInTheDocument();
    });

    it("显示总成本差异", () => {
      expect(screen.getByText("0.0133")).toBeInTheDocument();
    });

    it("总成本差异为正时 diff-up class", () => {
      const diffCells = document.querySelectorAll(".diff-up");
      expect(diffCells.length).toBeGreaterThan(0);
    });

    it("显示输入 Token", () => {
      expect(screen.getByText("输入 Token")).toBeInTheDocument();
    });

    it("显示运行 A 输入 Token", () => {
      expect(screen.getByText("1,000")).toBeInTheDocument();
    });

    it("显示运行 B 输入 Token", () => {
      expect(screen.getByText("1,500")).toBeInTheDocument();
    });

    it("显示输出 Token", () => {
      expect(screen.getByText("输出 Token")).toBeInTheDocument();
    });

    it("显示节点数", () => {
      expect(screen.getByText("节点数")).toBeInTheDocument();
    });

    it("显示运行 A 节点数", () => {
      expect(screen.getByText("3")).toBeInTheDocument();
    });

    it("显示运行 B 节点数", () => {
      expect(screen.getByText("4")).toBeInTheDocument();
    });

    it("有 run-compare__stats class", () => {
      expect(document.querySelector(".run-compare__stats")).toBeInTheDocument();
    });
  });

  describe("节点输出对比", () => {
    beforeEach(async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getAllByRole("combobox")[0].querySelectorAll("option").length).toBe(4);
      });
      const selects = screen.getAllByRole("combobox");
      fireEvent.change(selects[0], { target: { value: "run-1" } });
      fireEvent.change(selects[1], { target: { value: "run-2" } });
      fireEvent.click(screen.getByRole("button", { name: "开始对比" }));
      await waitFor(() => {
        expect(screen.getByText("节点输出对比")).toBeInTheDocument();
      });
    });

    it("显示'节点输出对比'标题", () => {
      expect(screen.getByText("节点输出对比")).toBeInTheDocument();
    });

    it("有 run-compare__outputs class", () => {
      expect(document.querySelector(".run-compare__outputs")).toBeInTheDocument();
    });

    it("显示所有节点（包括仅 B 有的节点）", () => {
      const nodeIds = document.querySelectorAll(".output-diff-item__node");
      expect(nodeIds.length).toBe(3); // node-1, node-2, node-3
    });

    it("显示 node-1", () => {
      expect(screen.getByText("node-1")).toBeInTheDocument();
    });

    it("显示 node-2", () => {
      expect(screen.getByText("node-2")).toBeInTheDocument();
    });

    it("显示 node-3（仅 B 有）", () => {
      expect(screen.getByText("node-3")).toBeInTheDocument();
    });

    it("显示 A 列标签", () => {
      expect(screen.getAllByText("A").length).toBeGreaterThan(0);
    });

    it("显示 B 列标签", () => {
      expect(screen.getAllByText("B").length).toBeGreaterThan(0);
    });

    it("显示运行 A 的输出", () => {
      const pres = document.querySelectorAll("pre.output-diff-col__text");
      const aOutputs = Array.from(pres).filter((_, i) => i % 2 === 0);
      expect(aOutputs[0].textContent).toContain("输出 A1");
    });

    it("显示运行 B 的输出", () => {
      expect(screen.getByText("输出 B2 不同")).toBeInTheDocument();
    });

    it("仅 B 有的节点 A 列显示'(无输出)'", () => {
      expect(screen.getAllByText("(无输出)").length).toBeGreaterThan(0);
    });

    it("显示差异行数", () => {
      const diffTexts = document.querySelectorAll(".output-diff-item__head .muted");
      expect(diffTexts.length).toBeGreaterThan(0);
    });

    it("有 output-diff-list class", () => {
      expect(document.querySelector(".output-diff-list")).toBeInTheDocument();
    });

    it("有 output-diff-item class", () => {
      expect(document.querySelector(".output-diff-item")).toBeInTheDocument();
    });

    it("有 output-diff-col class", () => {
      expect(document.querySelector(".output-diff-col")).toBeInTheDocument();
    });

    it("输出用 pre 标签", () => {
      expect(document.querySelector("pre.output-diff-col__text")).toBeInTheDocument();
    });
  });

  describe("关闭", () => {
    it("点击关闭按钮调用 onClose", () => {
      const { onClose } = renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "关闭" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击背景调用 onClose", () => {
      const { onClose } = renderComponent();
      const overlay = document.querySelector(".modal-overlay")!;
      fireEvent.click(overlay);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击模态框内容不调用 onClose", () => {
      const { onClose } = renderComponent();
      const modal = document.querySelector(".run-compare")!;
      fireEvent.click(modal);
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
