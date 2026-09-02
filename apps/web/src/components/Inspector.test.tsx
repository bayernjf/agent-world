import { render, screen, fireEvent, within } from "@testing-library/react";
import { useGraph } from "../store/graph";
import { useVisibleRuntime } from "../store/run";
import { api } from "../lib/api";
import Inspector from "./Inspector";

// Mock stores
vi.mock("../store/graph", () => ({
  useGraph: vi.fn(),
}));

vi.mock("../store/run", () => ({
  useVisibleRuntime: vi.fn(),
}));

// Mock api
vi.mock("../lib/api", () => ({
  api: {
    listGraphs: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue({ providers: {}, defaultModel: "", defaultProvider: "" }),
  },
  proxyImageUrl: vi.fn((url: string | null) => url),
}));

// Mock child components
vi.mock("./SkillPicker", () => ({
  default: () => <div data-testid="skill-picker">SkillPicker</div>,
}));

vi.mock("./FinishedProduct", () => ({
  default: () => <div data-testid="finished-product">FinishedProduct</div>,
}));

vi.mock("./ProductBlocks", () => ({
  default: () => <div data-testid="product-blocks">ProductBlocks</div>,
}));

vi.mock("./SourceImages", () => ({
  default: () => <div data-testid="source-images">SourceImages</div>,
}));

vi.mock("./SourceFiles", () => ({
  default: () => <div data-testid="source-files">SourceFiles</div>,
}));

vi.mock("./ConnectorEditor", () => ({
  default: () => <div data-testid="connector-editor">ConnectorEditor</div>,
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

vi.mock("../lib/artifact-renderers", () => ({
  ArtifactCard: () => <div data-testid="artifact-card">ArtifactCard</div>,
  renderMarkdown: (text: string) => <div>{text}</div>,
}));

const mockUseGraph = useGraph as unknown as ReturnType<typeof vi.fn>;
const mockUseVisibleRuntime = useVisibleRuntime as unknown as ReturnType<typeof vi.fn>;
const mockUpdateNode = vi.fn();

// Sample graph with one textGen node
const sampleGraph = {
  id: "graph-1",
  name: "测试产线",
  nodes: [
    {
      id: "node-1",
      kind: "textGen",
      name: "文坊节点",
      x: 100,
      y: 100,
      config: {},
    },
  ],
  edges: [],
};

function setupMocks(selectedId: string | null = "node-1", runtime?: unknown) {
  mockUseGraph.mockImplementation((selector?: (s: unknown) => unknown) => {
    const store = {
      graph: sampleGraph,
      selectedId,
      updateNode: mockUpdateNode,
      saveState: "saved",
      reloadGraph: vi.fn(),
    };
    if (selector) return selector(store);
    return store;
  });
  // useGraph.temporal is accessed directly, need to mock
  (useGraph as unknown as { temporal: { getState: () => { pause: () => void; resume: () => void }; setState: (fn: () => void) => void } }).temporal = {
    getState: () => ({ pause: vi.fn(), resume: vi.fn() }),
    setState: vi.fn(),
  };
  mockUseVisibleRuntime.mockReturnValue(runtime ?? { nodes: {} });
}

describe("Inspector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage for main tab persistence
    localStorage.clear();
  });

  describe("空状态", () => {
    it("没有选中节点时显示'选中一座节点查看详情'", () => {
      setupMocks(null);
      render(<Inspector onOpenSettings={() => {}} />);
      expect(screen.getByText("节点详情")).toBeInTheDocument();
      expect(screen.getByText("选中一座节点查看详情")).toBeInTheDocument();
    });

    it("没有选中节点时不显示 tab 切换", () => {
      setupMocks(null);
      render(<Inspector onOpenSettings={() => {}} />);
      expect(screen.queryByText("产出")).not.toBeInTheDocument();
      expect(screen.queryByText("配置")).not.toBeInTheDocument();
    });
  });

  describe("选中节点", () => {
    it("显示节点名称和 kind", () => {
      setupMocks("node-1");
      render(<Inspector onOpenSettings={() => {}} />);
      expect(screen.getByText("文坊节点")).toBeInTheDocument();
      expect(screen.getByText("textGen")).toBeInTheDocument();
    });

    it("显示 tab 切换（产出、配置、技能）", () => {
      setupMocks("node-1");
      render(<Inspector onOpenSettings={() => {}} />);
      expect(screen.getByRole("button", { name: "产出" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "配置" })).toBeInTheDocument();
      // textGen 节点有技能 tab
      expect(screen.getByRole("button", { name: "技能" })).toBeInTheDocument();
    });

    it("默认选中'产出' tab", () => {
      setupMocks("node-1");
      render(<Inspector onOpenSettings={() => {}} />);
      // 产出 tab 应该是 is-on 状态
      expect(screen.getByRole("button", { name: "产出" })).toHaveClass("is-on");
    });

    it("显示 E 键快捷键提示", () => {
      setupMocks("node-1");
      render(<Inspector onOpenSettings={() => {}} />);
      expect(screen.getByText("E")).toBeInTheDocument();
    });
  });

  describe("Tab 切换", () => {
    it("点击'产出' tab 切换到产出视图", () => {
      setupMocks("node-1");
      render(<Inspector onOpenSettings={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "产出" }));
      expect(screen.getByRole("button", { name: "产出" })).toHaveClass("is-on");
      expect(screen.getByRole("button", { name: "配置" })).not.toHaveClass("is-on");
    });

    it("点击'技能' tab 切换到技能视图", () => {
      setupMocks("node-1");
      render(<Inspector onOpenSettings={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "技能" }));
      expect(screen.getByRole("button", { name: "技能" })).toHaveClass("is-on");
      expect(screen.getByTestId("skill-picker")).toBeInTheDocument();
    });

    it("非 textGen 节点不显示'技能' tab", () => {
      const graphWithImageNode = {
        ...sampleGraph,
        nodes: [
          {
            id: "node-2",
            kind: "imageGen",
            name: "画坊节点",
            x: 100,
            y: 100,
            config: {},
          },
        ],
      };
      mockUseGraph.mockImplementation((selector?: (s: unknown) => unknown) => {
        const store = {
          graph: graphWithImageNode,
          selectedId: "node-2",
          updateNode: mockUpdateNode,
          saveState: "saved",
          reloadGraph: vi.fn(),
        };
        if (selector) return selector(store);
        return store;
      });
      (useGraph as unknown as { temporal: { getState: () => { pause: () => void; resume: () => void }; setState: (fn: () => void) => void } }).temporal = {
        getState: () => ({ pause: vi.fn(), resume: vi.fn() }),
        setState: vi.fn(),
      };
      mockUseVisibleRuntime.mockReturnValue({ nodes: {} });
      render(<Inspector onOpenSettings={() => {}} />);
      expect(screen.queryByRole("button", { name: "技能" })).not.toBeInTheDocument();
    });
  });

  describe("配置 tab", () => {
    it("显示名称输入框", () => {
      setupMocks("node-1");
      render(<Inspector onOpenSettings={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "配置" }));
      expect(screen.getByLabelText(/名称/)).toBeInTheDocument();
    });

    it("名称输入框显示当前节点名称", () => {
      setupMocks("node-1");
      render(<Inspector onOpenSettings={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "配置" }));
      const input = screen.getByLabelText(/名称/) as HTMLInputElement;
      expect(input.value).toBe("文坊节点");
    });

    it("修改名称调用 updateNode", () => {
      setupMocks("node-1");
      render(<Inspector onOpenSettings={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "配置" }));
      const input = screen.getByLabelText(/名称/);
      fireEvent.change(input, { target: { value: "新名称" } });
      expect(mockUpdateNode).toHaveBeenCalledWith("node-1", { name: "新名称" });
    });

    it("显示保存状态指示器", () => {
      setupMocks("node-1");
      render(<Inspector onOpenSettings={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "配置" }));
      // saveState = "saved"，应该显示"已保存"
      expect(screen.getByText("已保存")).toBeInTheDocument();
    });
  });

  describe("质检评分", () => {
    it("有质检评分时显示评分 chip", () => {
      const runtime = {
        nodes: {
          "node-1": {
            lastVerdict: { score: 8, reason: "质量很好" },
            reasoning: {},
            outputs: {},
            artifacts: [],
          },
        },
      };
      setupMocks("node-1", runtime);
      render(<Inspector onOpenSettings={() => {}} />);
      expect(screen.getByText(/质量 8\/10/)).toBeInTheDocument();
    });

    it("高分（>=7）显示 good 样式", () => {
      const runtime = {
        nodes: {
          "node-1": {
            lastVerdict: { score: 9, reason: "优秀" },
            reasoning: {},
            outputs: {},
            artifacts: [],
          },
        },
      };
      setupMocks("node-1", runtime);
      render(<Inspector onOpenSettings={() => {}} />);
      const chip = screen.getByText(/质量 9\/10/).closest(".chip")!;
      expect(chip).toHaveClass("chip--score-good");
    });

    it("低分（<4）显示 bad 样式", () => {
      const runtime = {
        nodes: {
          "node-1": {
            lastVerdict: { score: 2, reason: "很差" },
            reasoning: {},
            outputs: {},
            artifacts: [],
          },
        },
      };
      setupMocks("node-1", runtime);
      render(<Inspector onOpenSettings={() => {}} />);
      const chip = screen.getByText(/质量 2\/10/).closest(".chip")!;
      expect(chip).toHaveClass("chip--score-bad");
    });
  });
});
