import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import ABDialog from "./ABDialog";
import type { Graph } from "@agent-world/core";

beforeEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

// Mock api
const mockStartAB = vi.fn();
vi.mock("../lib/api", () => ({
  api: {
    startAB: (graphId: string, targetNodeId: string, variants: string[], budgetUsd: number | null, input: string) =>
      mockStartAB(graphId, targetNodeId, variants, budgetUsd, input),
  },
}));

// Mock Tooltip
vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const sampleGraph: Graph = {
  id: "graph-1",
  name: "测试产线",
  nodes: [
    { id: "node-1", kind: "source", name: "原料台", position: { x: 0, y: 0 }, config: {} },
    { id: "node-2", kind: "textGen", name: "文坊一", position: { x: 100, y: 0 }, config: {} },
    { id: "node-3", kind: "textGen", name: "文坊二", position: { x: 200, y: 0 }, config: {} },
    { id: "node-4", kind: "gate", name: "质检站", position: { x: 300, y: 0 }, config: {} },
  ],
  edges: [],
} as any;

const graphWithoutTextGen: Graph = {
  id: "graph-2",
  name: "无文坊产线",
  nodes: [
    { id: "node-1", kind: "source", name: "原料台", position: { x: 0, y: 0 }, config: {} },
    { id: "node-2", kind: "gate", name: "质检站", position: { x: 100, y: 0 }, config: {} },
  ],
  edges: [],
} as any;

function renderComponent(overrides: Partial<{
  open: boolean;
  graph: Graph | null;
  onClose: () => void;
  onLaunched: (groupId: string) => void;
}> = {}) {
  const onClose = vi.fn();
  const onLaunched = vi.fn();
  render(
    <ABDialog
      open={overrides.open ?? true}
      graph={overrides.graph ?? sampleGraph}
      onClose={overrides.onClose ?? onClose}
      onLaunched={overrides.onLaunched ?? onLaunched}
    />,
  );
  return {
    onClose: overrides.onClose ?? onClose,
    onLaunched: overrides.onLaunched ?? onLaunched,
  };
}

describe("ABDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartAB.mockResolvedValue({ abGroup: "ab-group-123" });
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(
        <ABDialog open={false} graph={sampleGraph} onClose={vi.fn()} onLaunched={vi.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("显示'A/B 实验'标题", () => {
      renderComponent();
      expect(screen.getByText("A/B 实验")).toBeInTheDocument();
    });

    it("显示目标文坊标签", () => {
      renderComponent();
      expect(screen.getByText("目标文坊（将替换其 prompt）")).toBeInTheDocument();
    });

    it("显示 Prompt 变体标签", () => {
      renderComponent();
      expect(screen.getByText(/Prompt 变体/)).toBeInTheDocument();
    });

    it("显示预算上限标签", () => {
      renderComponent();
      expect(screen.getByText("预算上限（USD，可选）")).toBeInTheDocument();
    });

    it("显示原材料标签", () => {
      renderComponent();
      expect(screen.getByText("原材料（可选）")).toBeInTheDocument();
    });

    it("显示发起 A/B 按钮", () => {
      renderComponent();
      expect(screen.getByText(/发起 A\/B/)).toBeInTheDocument();
    });

    it("有 modal-backdrop class", () => {
      renderComponent();
      expect(document.querySelector(".modal-backdrop")).toBeInTheDocument();
    });

    it("有 modal--wide class", () => {
      renderComponent();
      expect(document.querySelector(".modal--wide")).toBeInTheDocument();
    });
  });

  describe("无文坊节点", () => {
    it("显示无文坊提示", () => {
      renderComponent({ graph: graphWithoutTextGen });
      expect(screen.getByText(/当前产线没有文坊/)).toBeInTheDocument();
    });

    it("不显示目标文坊选择", () => {
      renderComponent({ graph: graphWithoutTextGen });
      expect(screen.queryByText("目标文坊（将替换其 prompt）")).not.toBeInTheDocument();
    });

    it("不显示发起 A/B 按钮", () => {
      const { container } = render(
        <ABDialog open={true} graph={graphWithoutTextGen} onClose={vi.fn()} onLaunched={vi.fn()} />,
      );
      expect(container.querySelector(".btn--block")).toBeNull();
    });

    it("提示有 muted class", () => {
      renderComponent({ graph: graphWithoutTextGen });
      expect(document.querySelector(".muted")).toBeInTheDocument();
    });
  });

  describe("目标文坊选择", () => {
    it("下拉框显示所有文坊节点", () => {
      renderComponent();
      const select = screen.getByRole("combobox");
      const options = select.querySelectorAll("option");
      expect(options.length).toBe(2);
      expect(options[0].textContent).toBe("文坊一");
      expect(options[1].textContent).toBe("文坊二");
    });

    it("默认选中第一个文坊节点", () => {
      renderComponent();
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.value).toBe("node-2");
    });

    it("可以切换目标文坊", () => {
      renderComponent();
      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "node-3" } });
      expect((select as HTMLSelectElement).value).toBe("node-3");
    });
  });

  describe("Prompt 变体", () => {
    it("显示变体输入框", () => {
      renderComponent();
      expect(screen.getByPlaceholderText(/版本一/)).toBeInTheDocument();
    });

    it("输入变体后显示已识别数量", () => {
      renderComponent();
      const textarea = screen.getByPlaceholderText(/版本一/);
      fireEvent.change(textarea, { target: { value: "变体一\n变体二" } });
      expect(screen.getByText("已识别 2 个变体（至少需要 2 个）。")).toBeInTheDocument();
    });

    it("空行被过滤", () => {
      renderComponent();
      const textarea = screen.getByPlaceholderText(/版本一/);
      fireEvent.change(textarea, { target: { value: "变体一\n\n变体二\n  \n变体三" } });
      expect(screen.getByText("已识别 3 个变体（至少需要 2 个）。")).toBeInTheDocument();
    });

    it("只有 1 个变体时提示至少需要 2 个", () => {
      renderComponent();
      const textarea = screen.getByPlaceholderText(/版本一/);
      fireEvent.change(textarea, { target: { value: "只有一个变体" } });
      expect(screen.getByText("已识别 1 个变体（至少需要 2 个）。")).toBeInTheDocument();
    });

    it("变体输入框有 field__hint class", () => {
      renderComponent();
      expect(document.querySelector(".field__hint")).toBeInTheDocument();
    });
  });

  describe("预算和原材料", () => {
    it("预算输入框有 placeholder", () => {
      renderComponent();
      expect(screen.getByPlaceholderText("留空则不限制")).toBeInTheDocument();
    });

    it("原材料输入框有 placeholder", () => {
      renderComponent();
      expect(screen.getByPlaceholderText("留空则使用产线默认原材料")).toBeInTheDocument();
    });

    it("可以输入预算", () => {
      renderComponent();
      const input = screen.getByPlaceholderText("留空则不限制");
      fireEvent.change(input, { target: { value: "100" } });
      expect(input).toHaveValue("100");
    });

    it("可以输入原材料", () => {
      renderComponent();
      const textarea = screen.getByPlaceholderText("留空则使用产线默认原材料");
      fireEvent.change(textarea, { target: { value: "测试原材料" } });
      expect(textarea).toHaveValue("测试原材料");
    });
  });

  describe("发起按钮状态", () => {
    it("变体不足 2 个时按钮禁用", () => {
      renderComponent();
      const textarea = screen.getByPlaceholderText(/版本一/);
      fireEvent.change(textarea, { target: { value: "只有一个变体" } });
      const button = screen.getByText(/发起 A\/B/);
      expect(button).toBeDisabled();
    });

    it("变体 >= 2 个时按钮启用", () => {
      renderComponent();
      const textarea = screen.getByPlaceholderText(/版本一/);
      fireEvent.change(textarea, { target: { value: "变体一\n变体二" } });
      const button = screen.getByText(/发起 A\/B/);
      expect(button).not.toBeDisabled();
    });

    it("按钮显示变体数量", () => {
      renderComponent();
      const textarea = screen.getByPlaceholderText(/版本一/);
      fireEvent.change(textarea, { target: { value: "变体一\n变体二\n变体三" } });
      expect(screen.getByText("发起 A/B（3 臂）")).toBeInTheDocument();
    });

    it("graph=null 时按钮禁用", () => {
      renderComponent({ graph: null });
      const button = screen.getByText(/发起 A\/B/);
      expect(button).toBeDisabled();
    });
  });

  describe("发起 A/B", () => {
    beforeEach(() => {
      renderComponent();
      const textarea = screen.getByPlaceholderText(/版本一/);
      fireEvent.change(textarea, { target: { value: "变体一\n变体二" } });
    });

    it("点击发起按钮调用 api.startAB", async () => {
      fireEvent.click(screen.getByText("发起 A/B（2 臂）"));
      await waitFor(() => {
        expect(mockStartAB).toHaveBeenCalledTimes(1);
      });
    });

    it("api.startAB 接收正确参数", async () => {
      const budgetInput = screen.getByPlaceholderText("留空则不限制");
      fireEvent.change(budgetInput, { target: { value: "50" } });
      const rawInput = screen.getByPlaceholderText("留空则使用产线默认原材料");
      fireEvent.change(rawInput, { target: { value: "测试原材料" } });
      fireEvent.click(screen.getByText("发起 A/B（2 臂）"));
      await waitFor(() => {
        expect(mockStartAB).toHaveBeenCalledWith(
          "graph-1",
          "node-2",
          ["变体一", "变体二"],
          50,
          "测试原材料",
        );
      });
    });

    it("预算为空时传 null", async () => {
      fireEvent.click(screen.getByText("发起 A/B（2 臂）"));
      await waitFor(() => {
        expect(mockStartAB).toHaveBeenCalledWith(
          "graph-1",
          "node-2",
          ["变体一", "变体二"],
          null,
          "",
        );
      });
    });

    it("发起成功后调用 onLaunched", async () => {
      const onLaunched = vi.fn();
      const { container } = render(
        <ABDialog open={true} graph={sampleGraph} onClose={vi.fn()} onLaunched={onLaunched} />,
      );
      const textarea = container.querySelector("textarea[rows='6']") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "变体一\n变体二" } });
      const button = container.querySelector(".btn--block") as HTMLButtonElement;
      fireEvent.click(button);
      await waitFor(() => {
        expect(onLaunched).toHaveBeenCalledWith("ab-group-123");
      });
    });

    it("发起中显示'发起中…'", async () => {
      mockStartAB.mockImplementation(() => new Promise(() => {}));
      fireEvent.click(screen.getByText("发起 A/B（2 臂）"));
      await waitFor(() => {
        expect(screen.getByText("发起中…")).toBeInTheDocument();
      });
    });

    it("发起中按钮禁用", async () => {
      mockStartAB.mockImplementation(() => new Promise(() => {}));
      fireEvent.click(screen.getByText("发起 A/B（2 臂）"));
      await waitFor(() => {
        expect(screen.getByText("发起中…")).toBeDisabled();
      });
    });

    it("发起失败显示错误信息", async () => {
      mockStartAB.mockRejectedValue(new Error("发起失败：模型不可用"));
      const { container } = render(
        <ABDialog open={true} graph={sampleGraph} onClose={vi.fn()} onLaunched={vi.fn()} />,
      );
      const textarea = container.querySelector("textarea[rows='6']") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "变体一\n变体二" } });
      const button = container.querySelector(".btn--block") as HTMLButtonElement;
      fireEvent.click(button);
      await waitFor(() => {
        expect(container.querySelector(".error-msg")?.textContent).toBe("Error: 发起失败：模型不可用");
      });
    });

    it("错误信息有 error-box class", async () => {
      mockStartAB.mockRejectedValue(new Error("发起失败"));
      fireEvent.click(screen.getByText("发起 A/B（2 臂）"));
      await waitFor(() => {
        expect(document.querySelector(".error-box")).toBeInTheDocument();
      });
    });

    it("错误信息有 error-msg class", async () => {
      mockStartAB.mockRejectedValue(new Error("发起失败"));
      fireEvent.click(screen.getByText("发起 A/B（2 臂）"));
      await waitFor(() => {
        expect(document.querySelector(".error-msg")).toBeInTheDocument();
      });
    });

    it("发起失败后按钮恢复可用", async () => {
      mockStartAB.mockRejectedValue(new Error("发起失败"));
      fireEvent.click(screen.getByText("发起 A/B（2 臂）"));
      await waitFor(() => {
        expect(screen.getByText("发起 A/B（2 臂）")).not.toBeDisabled();
      });
    });
  });

  describe("关闭", () => {
    it("点击关闭按钮调用 onClose", () => {
      const { onClose } = renderComponent();
      const header = document.querySelector(".modal__header");
      const closeBtn = header?.querySelector(".icon-btn") as HTMLButtonElement;
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击背景调用 onClose", () => {
      const { onClose } = renderComponent();
      const backdrop = document.querySelector(".modal-backdrop")!;
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击模态框内容不调用 onClose", () => {
      const { onClose } = renderComponent();
      const modal = document.querySelector(".modal")!;
      fireEvent.click(modal);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("状态重置", () => {
    it("重新打开时重置表单", () => {
      const { rerender } = render(
        <ABDialog open={true} graph={sampleGraph} onClose={vi.fn()} onLaunched={vi.fn()} />,
      );
      // 填写表单
      const textarea = screen.getByPlaceholderText(/版本一/);
      fireEvent.change(textarea, { target: { value: "变体一\n变体二" } });
      const budgetInput = screen.getByPlaceholderText("留空则不限制");
      fireEvent.change(budgetInput, { target: { value: "100" } });
      // 关闭再打开
      rerender(
        <ABDialog open={false} graph={sampleGraph} onClose={vi.fn()} onLaunched={vi.fn()} />,
      );
      rerender(
        <ABDialog open={true} graph={sampleGraph} onClose={vi.fn()} onLaunched={vi.fn()} />,
      );
      expect(screen.getByPlaceholderText(/版本一/)).toHaveValue("");
      expect(screen.getByPlaceholderText("留空则不限制")).toHaveValue("");
    });
  });
});
