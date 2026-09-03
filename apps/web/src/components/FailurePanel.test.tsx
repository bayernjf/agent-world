import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useGraph } from "../store/graph";
import { useVisibleRuntime, useRun, resumeRun } from "../store/run";
import FailurePanel from "./FailurePanel";
import type { FailureRecord } from "@agent-world/core";

vi.mock("../store/graph", () => ({
  useGraph: vi.fn(),
}));

vi.mock("../store/run", () => ({
  useVisibleRuntime: vi.fn(),
  useRun: vi.fn(),
  resumeRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockUseGraph = useGraph as unknown as ReturnType<typeof vi.fn>;
const mockUseVisibleRuntime = useVisibleRuntime as unknown as ReturnType<typeof vi.fn>;
const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockResumeRun = resumeRun as unknown as ReturnType<typeof vi.fn>;

const sampleGraph = {
  id: "g1",
  name: "测试产线",
  nodes: [
    { id: "n1", kind: "source", name: "原料台", x: 0, y: 0 },
    { id: "n2", kind: "textGen", name: "文坊1", x: 100, y: 0 },
    { id: "n3", kind: "gate", name: "质检站", x: 200, y: 0 },
    { id: "n4", kind: "sink", name: "成品库", x: 300, y: 0 },
  ],
  edges: [
    { from: "n1", to: "n2", kind: "flow" },
    { from: "n2", to: "n3", kind: "flow" },
    { from: "n3", to: "n4", kind: "flow" },
  ],
};

const sampleFailures: FailureRecord[] = [
  {
    seq: 1,
    nodeId: "n2",
    errorCode: "TIMEOUT",
    error: "模型调用超时，超过 30 秒",
    ts: Date.now() - 60000,
    attempt: 2,
  },
  {
    seq: 2,
    nodeId: "n3",
    errorCode: "VALIDATION",
    error: "输出格式校验失败",
    ts: Date.now() - 30000,
    attempt: 1,
  },
];

function setupMocks(status = "failed", failures: FailureRecord[] = sampleFailures) {
  mockUseGraph.mockImplementation((selector?: (s: unknown) => unknown) => {
    const store = { graph: sampleGraph };
    if (selector) return selector(store);
    return store;
  });
  mockUseVisibleRuntime.mockReturnValue({
    status,
    failures,
    nodes: {
      n1: { status: "done" },
      n2: { status: "failed" },
      n3: { status: "failed" },
      n4: { status: "idle" },
    },
  });
  mockUseRun.mockImplementation((selector?: (s: unknown) => unknown) => {
    const store = { reset: vi.fn() };
    if (selector) return selector(store);
    return store;
  });
}

function renderPanel(onRerun = vi.fn()) {
  return render(<FailurePanel onRerun={onRerun} />);
}

describe("FailurePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  describe("渲染", () => {
    it("failed 状态显示'产线运行失败'标题", () => {
      setupMocks("failed");
      renderPanel();
      expect(screen.getByText("产线运行失败")).toBeInTheDocument();
    });

    it("tripped 状态显示'电力不足，全厂停机'标题", () => {
      setupMocks("tripped");
      renderPanel();
      expect(screen.getByText("电力不足，全厂停机")).toBeInTheDocument();
    });

    it("显示失败记录数量", () => {
      renderPanel();
      expect(screen.getByText(/共 2 条失败记录/)).toBeInTheDocument();
    });

    it("显示关闭按钮", () => {
      renderPanel();
      expect(screen.getByRole("button", { name: "✕" })).toBeInTheDocument();
    });

    it("显示'整条重跑'按钮", () => {
      renderPanel();
      expect(screen.getByRole("button", { name: "整条重跑" })).toBeInTheDocument();
    });

    it("idle 状态不显示面板", () => {
      setupMocks("idle");
      const { container } = renderPanel();
      expect(container.firstChild).toBeNull();
    });

    it("running 状态不显示面板", () => {
      setupMocks("running");
      const { container } = renderPanel();
      expect(container.firstChild).toBeNull();
    });

    it("done 状态不显示面板", () => {
      setupMocks("done");
      const { container } = renderPanel();
      expect(container.firstChild).toBeNull();
    });
  });

  describe("失败记录列表", () => {
    it("显示失败节点名称", () => {
      renderPanel();
      expect(screen.getByText("文坊1")).toBeInTheDocument();
      expect(screen.getByText("质检站")).toBeInTheDocument();
    });

    it("显示错误类型标签", () => {
      renderPanel();
      expect(screen.getByText("超时")).toBeInTheDocument();
      expect(screen.getByText("校验失败")).toBeInTheDocument();
    });

    it("显示尝试次数", () => {
      renderPanel();
      expect(screen.getByText("第 2 次")).toBeInTheDocument();
      expect(screen.getByText("第 1 次")).toBeInTheDocument();
    });

    it("显示错误消息", () => {
      renderPanel();
      expect(screen.getByText("模型调用超时，超过 30 秒")).toBeInTheDocument();
      expect(screen.getByText("输出格式校验失败")).toBeInTheDocument();
    });

    it("显示影响下游节点数", () => {
      renderPanel();
      // n2 失败影响 n3、n4（2 座下游节点未启动）
      expect(screen.getByText(/影响：2 座下游节点未启动/)).toBeInTheDocument();
    });

    it("每个失败记录显示'重试该节点'按钮", () => {
      renderPanel();
      const buttons = screen.getAllByRole("button", { name: "重试该节点" });
      expect(buttons.length).toBe(2);
    });

    it("每个失败记录显示'返工到上游'按钮", () => {
      renderPanel();
      const buttons = screen.getAllByRole("button", { name: /返工到上游/ });
      expect(buttons.length).toBe(2);
    });
  });

  describe("重试该节点", () => {
    it("点击'重试该节点'调用 resumeRun", async () => {
      renderPanel();
      const buttons = screen.getAllByRole("button", { name: "重试该节点" });
      fireEvent.click(buttons[0]);
      await waitFor(() => {
        expect(mockResumeRun).toHaveBeenCalledWith("continue", "n2");
      });
    });

    it("点击第二个'重试该节点'调用 resumeRun 对应节点", async () => {
      renderPanel();
      const buttons = screen.getAllByRole("button", { name: "重试该节点" });
      fireEvent.click(buttons[1]);
      await waitFor(() => {
        expect(mockResumeRun).toHaveBeenCalledWith("continue", "n3");
      });
    });
  });

  describe("返工到上游", () => {
    it("点击'返工到上游'展开下拉菜单", () => {
      renderPanel();
      const buttons = screen.getAllByRole("button", { name: /返工到上游/ });
      fireEvent.click(buttons[0]);
      // 上游已完成节点是 n1（原料台）
      expect(screen.getByText("原料台")).toBeInTheDocument();
    });

    it("点击上游节点选项调用 resumeRun", async () => {
      renderPanel();
      const buttons = screen.getAllByRole("button", { name: /返工到上游/ });
      fireEvent.click(buttons[0]);
      // 点击上游节点选项
      const option = screen.getByText("原料台");
      fireEvent.click(option);
      await waitFor(() => {
        expect(mockResumeRun).toHaveBeenCalledWith("continue", "n1");
      });
    });

    it("再次点击'返工到上游'收起下拉菜单", () => {
      renderPanel();
      const buttons = screen.getAllByRole("button", { name: /返工到上游/ });
      fireEvent.click(buttons[0]);
      expect(screen.getByText("原料台")).toBeInTheDocument();
      fireEvent.click(buttons[0]);
      expect(screen.queryByText("原料台")).not.toBeInTheDocument();
    });
  });

  describe("整条重跑", () => {
    it("点击'整条重跑'调用 onRerun", () => {
      const onRerun = vi.fn();
      renderPanel(onRerun);
      fireEvent.click(screen.getByRole("button", { name: "整条重跑" }));
      expect(onRerun).toHaveBeenCalledTimes(1);
    });
  });

  describe("关闭/重置", () => {
    it("点击关闭按钮调用 reset", () => {
      const reset = vi.fn();
      mockUseRun.mockImplementation((selector?: (s: unknown) => unknown) => {
        const store = { reset };
        if (selector) return selector(store);
        return store;
      });
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "✕" }));
      expect(reset).toHaveBeenCalledTimes(1);
    });
  });

  describe("底部提示", () => {
    it("有失败节点时显示重试/返工说明", () => {
      renderPanel();
      expect(screen.getByText(/重试只重跑失败节点及下游/)).toBeInTheDocument();
    });

    it("无失败节点（预算停机）时显示预算说明", () => {
      setupMocks("tripped", []);
      renderPanel();
      expect(screen.getByText(/预算停机后请调高预算再整条重跑/)).toBeInTheDocument();
    });
  });
});
