import { render, screen, fireEvent, within } from "@testing-library/react";
import { useGraph } from "../store/graph";
import { useRun, useVisibleRuntime } from "../store/run";
import { api } from "../lib/api";
import ControlPanel from "./ControlPanel";
import type { Mode } from "../canvas/Canvas";
import type { Diagnostic } from "@agent-world/core";

// Mock stores
vi.mock("../store/graph", () => ({
  useGraph: vi.fn(),
}));

vi.mock("../store/run", () => ({
  useRun: vi.fn(),
  useVisibleRuntime: vi.fn(),
  resumeRun: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({ providers: {}, defaultModel: "", defaultProvider: "" }),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockUseGraph = useGraph as unknown as ReturnType<typeof vi.fn>;
const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;
const mockUseVisibleRuntime = useVisibleRuntime as unknown as ReturnType<typeof vi.fn>;
const mockSetMode = vi.fn();
const mockSetBudget = vi.fn();
const mockSetRawMaterial = vi.fn();
const mockOnRun = vi.fn();
const mockOnCancel = vi.fn();
const mockOnOpenSettings = vi.fn();
const mockOnOpenHistory = vi.fn();
const mockOnOpenModelAssign = vi.fn();

const defaultProps = {
  mode: "select" as Mode,
  setMode: mockSetMode,
  budget: 1.0,
  setBudget: mockSetBudget,
  rawMaterial: "测试原料",
  setRawMaterial: mockSetRawMaterial,
  diagnostics: [] as Diagnostic[],
  canRun: true,
  onRun: mockOnRun,
  onCancel: mockOnCancel,
  onOpenSettings: mockOnOpenSettings,
  onOpenHistory: mockOnOpenHistory,
  onOpenModelAssign: mockOnOpenModelAssign,
};

function setupMocks(status = "idle", nodes = 5, runId: string | null = null) {
  mockUseGraph.mockImplementation((selector?: (s: unknown) => unknown) => {
    const store = {
      graph: { id: "g1", name: "测试产线", nodes: Array(nodes).fill(null).map((_, i) => ({ id: `n${i}`, kind: "textGen", name: `节点${i}`, x: 0, y: 0 })), edges: [] },
      saveState: "saved",
    };
    if (selector) return selector(store);
    return store;
  });
  mockUseRun.mockReturnValue({
    runId,
    connecting: false,
    reconnecting: false,
  });
  mockUseVisibleRuntime.mockReturnValue({
    status,
    totalCostUsd: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalCachedTokens: 0,
    totalUnits: {},
    budgetWarned: false,
    monthlyBudgetWarned: false,
    nodes: {},
    haltedNodeId: null,
    reason: null,
  });
}

function renderPanel(props = {}) {
  return render(<ControlPanel {...defaultProps} {...props} />);
}

describe("ControlPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  describe("渲染", () => {
    it("显示标题'控制面板'", () => {
      renderPanel();
      expect(screen.getByText("控制面板")).toBeInTheDocument();
    });

    it("显示 LED 状态灯", () => {
      renderPanel();
      expect(document.querySelector(".led")).toBeInTheDocument();
    });

    it("显示'电力'标题", () => {
      renderPanel();
      expect(screen.getByText("电力")).toBeInTheDocument();
    });

    it("显示'工具'标题", () => {
      renderPanel();
      expect(screen.getByText("工具")).toBeInTheDocument();
    });

    it("显示'状态'标题", () => {
      renderPanel();
      expect(screen.getByText("状态")).toBeInTheDocument();
    });

    it("显示所有 5 个工具模式按钮", () => {
      renderPanel();
      expect(screen.getByRole("button", { name: "选择" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "铺管道" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "返工线" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "容错线" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "拆除" })).toBeInTheDocument();
    });

    it("默认选中'选择'模式", () => {
      renderPanel();
      expect(screen.getByRole("button", { name: "选择" })).toHaveClass("is-on");
    });
  });

  describe("工具模式切换", () => {
    it("点击'铺管道'调用 setMode", () => {
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "铺管道" }));
      expect(mockSetMode).toHaveBeenCalledWith("connect");
    });

    it("点击'返工线'调用 setMode", () => {
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "返工线" }));
      expect(mockSetMode).toHaveBeenCalledWith("rework");
    });

    it("点击'容错线'调用 setMode", () => {
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "容错线" }));
      expect(mockSetMode).toHaveBeenCalledWith("error");
    });

    it("点击'拆除'调用 setMode", () => {
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "拆除" }));
      expect(mockSetMode).toHaveBeenCalledWith("delete");
    });

    it("工具按钮有 hint title", () => {
      renderPanel();
      expect(screen.getByRole("button", { name: "选择" })).toHaveAttribute("title");
      expect(screen.getByRole("button", { name: "铺管道" })).toHaveAttribute("title");
    });
  });

  describe("状态显示", () => {
    it("idle 状态显示'产线就绪 · 等待投料'", () => {
      setupMocks("idle");
      renderPanel();
      expect(screen.getByText("产线就绪 · 等待投料")).toBeInTheDocument();
    });

    it("running 状态显示'运行中'", () => {
      setupMocks("running");
      renderPanel();
      expect(screen.getByText("运行中")).toBeInTheDocument();
    });

    it("done 状态显示'全部出厂'", () => {
      setupMocks("done");
      renderPanel();
      expect(screen.getByText("全部出厂")).toBeInTheDocument();
    });

    it("failed 状态显示'产线故障'", () => {
      setupMocks("failed");
      renderPanel();
      expect(screen.getByText("产线故障")).toBeInTheDocument();
    });

    it("无错误无警告时显示'图可编译 · N 座节点'", () => {
      setupMocks("idle", 5);
      renderPanel();
      expect(screen.getByText(/图可编译 · 5 座节点/)).toBeInTheDocument();
    });

    it("已保存时显示'已保存'", () => {
      setupMocks("idle");
      renderPanel();
      // "已保存"在 <span className="muted"> · 已保存</span> 中
      expect(screen.getByText(/已保存/)).toBeInTheDocument();
    });

    it("显示错误诊断信息", () => {
      const diagnostics: Diagnostic[] = [
        { severity: "error", message: "节点未连接" },
      ];
      renderPanel({ diagnostics });
      expect(screen.getByText("节点未连接")).toBeInTheDocument();
      expect(screen.getByText("节点未连接").closest(".diag")).toHaveClass("diag--error");
    });

    it("显示警告诊断信息", () => {
      const diagnostics: Diagnostic[] = [
        { severity: "warning", message: "模型未配置" },
      ];
      renderPanel({ diagnostics });
      expect(screen.getByText("模型未配置")).toBeInTheDocument();
      expect(screen.getByText("模型未配置").closest(".diag")).toHaveClass("diag--warn");
    });
  });

  describe("运行控制", () => {
    it("idle 状态显示'派发任务'按钮", () => {
      setupMocks("idle");
      renderPanel();
      expect(screen.getByRole("button", { name: "派发任务" })).toBeInTheDocument();
    });

    it("点击'派发任务'调用 onRun", () => {
      setupMocks("idle");
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "派发任务" }));
      expect(mockOnRun).toHaveBeenCalledTimes(1);
    });

    it("canRun=false 时派发按钮被禁用", () => {
      setupMocks("idle");
      renderPanel({ canRun: false });
      expect(screen.getByRole("button", { name: "派发任务" })).toBeDisabled();
    });

    it("原料为空时派发按钮被禁用", () => {
      setupMocks("idle");
      renderPanel({ rawMaterial: "" });
      expect(screen.getByRole("button", { name: "派发任务" })).toBeDisabled();
    });

    it("running 状态显示'停机'按钮", () => {
      setupMocks("running");
      renderPanel();
      expect(screen.getByRole("button", { name: "停机" })).toBeInTheDocument();
    });

    it("点击'停机'调用 onCancel", () => {
      setupMocks("running", 5, "run-123");
      renderPanel();
      fireEvent.click(screen.getByRole("button", { name: "停机" }));
      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe("快捷入口", () => {
    it("显示设置按钮", () => {
      renderPanel();
      expect(screen.getByRole("button", { name: /设置/ })).toBeInTheDocument();
    });

    it("点击设置按钮调用 onOpenSettings", () => {
      renderPanel();
      const settingsBtn = screen.getAllByRole("button").find((b) => b.textContent?.includes("设置"));
      if (settingsBtn) fireEvent.click(settingsBtn);
      expect(mockOnOpenSettings).toHaveBeenCalled();
    });

    it("显示历史按钮", () => {
      renderPanel();
      expect(screen.getByRole("button", { name: /历史/ })).toBeInTheDocument();
    });

    it("点击历史按钮调用 onOpenHistory", () => {
      renderPanel();
      const historyBtn = screen.getByRole("button", { name: /历史/ });
      fireEvent.click(historyBtn);
      expect(mockOnOpenHistory).toHaveBeenCalledTimes(1);
    });

    it("显示模型分配按钮", () => {
      renderPanel();
      expect(screen.getByRole("button", { name: /模型分配/ })).toBeInTheDocument();
    });

    it("点击模型分配按钮调用 onOpenModelAssign", () => {
      renderPanel();
      const modelBtn = screen.getByRole("button", { name: /模型分配/ });
      fireEvent.click(modelBtn);
      expect(mockOnOpenModelAssign).toHaveBeenCalledTimes(1);
    });
  });

  describe("电表", () => {
    it("未配置单价时显示 Token 模式提示", () => {
      setupMocks("idle");
      renderPanel();
      expect(screen.getByText(/电力读数待派发后出现/)).toBeInTheDocument();
    });

    it("配置单价后显示电费/Token 切换按钮", () => {
      (api.getSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        providers: {
          test: {
            type: "openai",
            models: ["gpt-4o"],
            pricing: { "gpt-4o": { input: 0.001, output: 0.002 } },
          },
        },
        defaultModel: "gpt-4o",
        defaultProvider: "test",
      });
      renderPanel();
      // 等待 useEffect 加载 settings
      return new Promise((resolve) => setTimeout(resolve, 100)).then(() => {
        expect(screen.getByRole("button", { name: "电费" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Token" })).toBeInTheDocument();
      });
    });
  });
});
