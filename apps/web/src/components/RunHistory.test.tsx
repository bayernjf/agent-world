import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import RunHistory from "./RunHistory";
import type { RunSummary } from "../lib/api";

// Mock api
vi.mock("../lib/api", () => ({
  api: {
    listRuns: vi.fn(),
    listGraphs: vi.fn(),
    rerunRun: vi.fn(),
    runStats: vi.fn(),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockListRuns = api.listRuns as unknown as ReturnType<typeof vi.fn>;
const mockListGraphs = api.listGraphs as unknown as ReturnType<typeof vi.fn>;
const mockRerunRun = api.rerunRun as unknown as ReturnType<typeof vi.fn>;
const mockRunStats = api.runStats as unknown as ReturnType<typeof vi.fn>;

// Sample runs
const sampleRuns: RunSummary[] = [
  {
    id: "run-1",
    graph_id: "graph-1",
    graph_name: "测试产线",
    status: "done",
    started_at: Date.now() - 60000,
    ended_at: Date.now() - 30000,
    trigger: "manual",
  },
  {
    id: "run-2",
    graph_id: "graph-1",
    graph_name: "测试产线",
    status: "failed",
    started_at: Date.now() - 120000,
    ended_at: Date.now() - 90000,
    trigger: "cron",
  },
  {
    id: "run-3",
    graph_id: "graph-2",
    graph_name: "另一条产线",
    status: "running",
    started_at: Date.now() - 10000,
    ended_at: null,
    trigger: "webhook",
  },
];

const sampleGraphs = [
  { id: "graph-1", name: "测试产线" },
  { id: "graph-2", name: "另一条产线" },
];

function setupMocks(runs = sampleRuns, total = sampleRuns.length) {
  mockListRuns.mockResolvedValue({ runs, total });
  mockListGraphs.mockResolvedValue(sampleGraphs);
  mockRerunRun.mockResolvedValue({ runId: "new-run-1" });
  mockRunStats.mockResolvedValue({
    nodes: 5,
    tokensIn: 1000,
    tokensOut: 500,
    costUsd: 0.0123,
  });
}

async function renderAndWait(open = true) {
  const onClose = vi.fn();
  const onOpen = vi.fn();
  render(<RunHistory open={open} onClose={onClose} onOpen={onOpen} />);
  if (open) {
    // 等待运行列表加载完成
    await screen.findByText("运行历史");
    await waitFor(() => {
      expect(mockListRuns).toHaveBeenCalled();
    });
  }
  return { onClose, onOpen };
}

describe("RunHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(<RunHistory open={false} onClose={vi.fn()} />);
      expect(container).toBeEmptyDOMElement();
    });

    it("open=true 时显示标题'运行历史'", async () => {
      await renderAndWait();
      expect(screen.getByText("运行历史")).toBeInTheDocument();
    });

    it("显示关闭按钮", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "✕" })).toBeInTheDocument();
    });

    it("显示'选择对比'按钮", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "选择对比" })).toBeInTheDocument();
    });

    it("调用 api.listRuns 和 api.listGraphs", async () => {
      await renderAndWait();
      expect(mockListRuns).toHaveBeenCalledTimes(1);
      expect(mockListGraphs).toHaveBeenCalledTimes(1);
    });
  });

  describe("运行列表", () => {
    it("显示运行记录的产线名", async () => {
      await renderAndWait();
      // 产线名出现在运行记录和过滤下拉框中，用 getAllByText
      expect(screen.getAllByText("测试产线").length).toBeGreaterThan(0);
      expect(screen.getAllByText("另一条产线").length).toBeGreaterThan(0);
    });

    it("显示运行状态标签", async () => {
      await renderAndWait();
      // 状态标签出现在运行记录和过滤下拉框中
      expect(screen.getAllByText("全部出厂").length).toBeGreaterThan(0);
      expect(screen.getAllByText("产线故障").length).toBeGreaterThan(0);
      expect(screen.getAllByText("运行中").length).toBeGreaterThan(0);
    });

    it("显示触发方式", async () => {
      await renderAndWait();
      expect(screen.getByText("manual")).toBeInTheDocument();
      expect(screen.getByText("cron")).toBeInTheDocument();
      expect(screen.getByText("webhook")).toBeInTheDocument();
    });

    it("空列表时显示提示", async () => {
      setupMocks([], 0);
      await renderAndWait();
      expect(screen.getByText("没有匹配的运行")).toBeInTheDocument();
    });
  });

  describe("过滤", () => {
    it("显示产线过滤下拉框", async () => {
      await renderAndWait();
      expect(screen.getByLabelText("产线")).toBeInTheDocument();
    });

    it("产线过滤下拉框包含'全部'和所有产线", async () => {
      await renderAndWait();
      const select = screen.getByLabelText("产线");
      const options = within(select).getAllByRole("option");
      expect(options[0]).toHaveValue("");
      expect(options[0]).toHaveTextContent("全部");
      expect(options.length).toBe(3); // 全部 + 2 条产线
    });

    it("显示状态过滤下拉框", async () => {
      await renderAndWait();
      expect(screen.getByLabelText("状态")).toBeInTheDocument();
    });

    it("状态过滤下拉框包含所有状态", async () => {
      await renderAndWait();
      const select = screen.getByLabelText("状态");
      const options = within(select).getAllByRole("option");
      expect(options.length).toBeGreaterThan(5); // 全部 + 多种状态
    });

    it("切换产线过滤重新加载运行列表", async () => {
      await renderAndWait();
      const select = screen.getByLabelText("产线");
      fireEvent.change(select, { target: { value: "graph-1" } });
      await waitFor(() => {
        expect(mockListRuns).toHaveBeenCalledTimes(2);
      });
      expect(mockListRuns).toHaveBeenLastCalledWith(
        expect.objectContaining({ graphId: "graph-1" }),
      );
    });

    it("切换状态过滤重新加载运行列表", async () => {
      await renderAndWait();
      const select = screen.getByLabelText("状态");
      fireEvent.change(select, { target: { value: "done" } });
      await waitFor(() => {
        expect(mockListRuns).toHaveBeenCalledTimes(2);
      });
      expect(mockListRuns).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "done" }),
      );
    });
  });

  describe("分页", () => {
    it("显示每页大小选择", async () => {
      await renderAndWait();
      expect(document.querySelector(".runhistory-pager-size")).toBeInTheDocument();
    });

    it("每页大小包含 10/20/50/100", async () => {
      await renderAndWait();
      const pager = document.querySelector(".runhistory-pager-size")!;
      const select = pager.querySelector("select")!;
      const options = within(select as HTMLElement).getAllByRole("option");
      expect(options.length).toBe(4);
      expect(options[0]).toHaveValue("10");
      expect(options[1]).toHaveValue("20");
      expect(options[2]).toHaveValue("50");
      expect(options[3]).toHaveValue("100");
    });

    it("默认每页 20 条", async () => {
      await renderAndWait();
      const pager = document.querySelector(".runhistory-pager-size")!;
      const select = pager.querySelector("select") as HTMLSelectElement;
      expect(select.value).toBe("20");
    });

    it("切换每页大小更新 select 值", async () => {
      await renderAndWait();
      const pager = document.querySelector(".runhistory-pager-size")!;
      const select = pager.querySelector("select") as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "50" } });
      expect(select.value).toBe("50");
    });
  });

  describe("选择对比模式", () => {
    it("点击'选择对比'进入对比模式", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "选择对比" }));
      expect(screen.getByRole("button", { name: "退出选择" })).toBeInTheDocument();
    });

    it("对比模式下显示复选框", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "选择对比" }));
      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes.length).toBeGreaterThan(0);
    });

    it("勾选运行后显示'对比选中'按钮", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "选择对比" }));
      const checkboxes = screen.getAllByRole("checkbox");
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);
      expect(screen.getByRole("button", { name: /对比选中/ })).toBeInTheDocument();
    });

    it("点击'对比选中'显示对比视图", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "选择对比" }));
      const checkboxes = screen.getAllByRole("checkbox");
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);
      fireEvent.click(screen.getByRole("button", { name: /对比选中/ }));
      await waitFor(() => {
        expect(mockRunStats).toHaveBeenCalledTimes(2);
      });
      // 对比视图显示返回按钮
      expect(screen.getByRole("button", { name: "返回列表" })).toBeInTheDocument();
    });

    it("对比视图显示对比表格", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "选择对比" }));
      const checkboxes = screen.getAllByRole("checkbox");
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);
      fireEvent.click(screen.getByRole("button", { name: /对比选中/ }));
      // 等待对比视图加载完成
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "返回列表" })).toBeInTheDocument();
      });
      // 对比表格的行标签（可能在多处出现，用 getAllByText）
      expect(screen.getAllByText("产线").length).toBeGreaterThan(0);
      expect(screen.getAllByText("状态").length).toBeGreaterThan(0);
      expect(screen.getByText("节点数")).toBeInTheDocument();
      expect(screen.getByText("成本")).toBeInTheDocument();
    });

    it("点击'返回列表'回到列表视图", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "选择对比" }));
      const checkboxes = screen.getAllByRole("checkbox");
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);
      fireEvent.click(screen.getByRole("button", { name: /对比选中/ }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "返回列表" })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
      expect(screen.queryByRole("button", { name: "返回列表" })).not.toBeInTheDocument();
    });
  });

  describe("重新运行", () => {
    it("显示重新运行按钮", async () => {
      await renderAndWait();
      expect(screen.getAllByRole("button", { name: /重新运行/ }).length).toBeGreaterThan(0);
    });

    it("点击重新运行调用 api.rerunRun", async () => {
      const { onOpen } = await renderAndWait();
      const rerunBtns = screen.getAllByRole("button", { name: /重新运行/ });
      fireEvent.click(rerunBtns[0]);
      await waitFor(() => {
        expect(mockRerunRun).toHaveBeenCalledTimes(1);
      });
      expect(mockRerunRun).toHaveBeenCalledWith("run-1");
    });

    it("重新运行成功后调用 onOpen", async () => {
      const { onOpen } = await renderAndWait();
      const rerunBtns = screen.getAllByRole("button", { name: /重新运行/ });
      fireEvent.click(rerunBtns[0]);
      await waitFor(() => {
        expect(onOpen).toHaveBeenCalledWith("new-run-1");
      });
    });

    it("重新运行失败显示错误信息", async () => {
      mockRerunRun.mockRejectedValue(new Error("产线不存在"));
      await renderAndWait();
      const rerunBtns = screen.getAllByRole("button", { name: /重新运行/ });
      fireEvent.click(rerunBtns[0]);
      await waitFor(() => {
        expect(screen.getByText(/重新运行失败：产线不存在/)).toBeInTheDocument();
      });
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
      fireEvent.click(document.querySelector(".modal-backdrop")!);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击模态框内容不调用 onClose", async () => {
      const { onClose } = await renderAndWait();
      fireEvent.click(document.querySelector(".modal")!);
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
