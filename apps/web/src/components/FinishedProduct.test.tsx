import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FinishedProduct from "./FinishedProduct";
import type { Graph, RuntimeState, Artifact } from "@agent-world/core";

// Mock @agent-world/core
vi.mock("@agent-world/core", () => ({
  incoming: vi.fn((graph: Graph, id: string, kind: string) => {
    const edges = graph.edges?.filter((e: any) => e.to === id && e.kind === kind) ?? [];
    return edges;
  }),
  parseProductDocument: vi.fn((text: string) => {
    if (text.includes("product-json")) return { blocks: [] };
    return null;
  }),
}));

// Mock ProductBlocks
vi.mock("./ProductBlocks", () => ({
  default: ({ doc }: { doc: any }) => (
    <div data-testid="product-blocks">ProductBlocks rendered</div>
  ),
}));

// Mock product-html
vi.mock("../lib/product-html", () => ({
  productToHtml: vi.fn(() => "<html>product</html>"),
  productToLongImage: vi.fn(async () => "data:image/png;base64,mock"),
}));

// Mock artifact-renderers
vi.mock("../lib/artifact-renderers", () => ({
  ArtifactCard: ({ a, showMeta }: { a: Artifact; showMeta?: boolean }) => (
    <div data-testid={`artifact-${a.id}`} className="artifact-card">
      {a.kind}: {a.content?.slice(0, 50)}
    </div>
  ),
  renderMarkdown: (text: string) => (
    <div data-testid="markdown-rendered" dangerouslySetInnerHTML={{ __html: text }} />
  ),
}));

const sampleGraph: Graph = {
  id: "g1",
  name: "小红书种草笔记",
  nodes: [
    { id: "sink", type: "sink", x: 0, y: 0 },
    { id: "textgen", type: "textgen", x: 0, y: 0 },
    { id: "imagegen", type: "imagegen", x: 0, y: 0 },
  ],
  edges: [
    { id: "e1", from: "textgen", to: "sink", kind: "flow" },
    { id: "e2", from: "imagegen", to: "sink", kind: "flow" },
  ],
} as any;

const sampleRuntime: RuntimeState = {
  status: "done",
  nodes: {
    sink: {
      status: "done",
      outputs: { 0: "# 成品标题\n\n这是成品内容。" },
      artifacts: [],
    },
    textgen: {
      status: "done",
      artifacts: [
        {
          id: "a1",
          kind: "text",
          content: "这是文本生成节点的产出。",
          mime: "text/plain",
        },
      ],
    },
    imagegen: {
      status: "done",
      artifacts: [
        {
          id: "a2",
          kind: "image",
          content: "https://example.com/image.png",
          mime: "image/png",
        },
      ],
    },
  },
} as any;

const emptyRuntime: RuntimeState = {
  status: "idle",
  nodes: {
    sink: { status: "idle", outputs: {}, artifacts: [] },
  },
} as any;

function renderComponent(sinkId = "sink", graph = sampleGraph, runtime = sampleRuntime) {
  render(<FinishedProduct sinkId={sinkId} graph={graph} runtime={runtime} />);
}

describe("FinishedProduct", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => {}),
        write: vi.fn(async () => {}),
      },
    });
    // Mock ClipboardItem
    (global as any).ClipboardItem = vi.fn().mockImplementation((data: any) => ({
      types: Object.keys(data),
      getType: vi.fn(async (type: string) => data[type]),
    }));
    // Mock URL.createObjectURL and revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = vi.fn();
    // Mock anchor click
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  describe("空状态", () => {
    it("没有文本和产物时显示空状态", () => {
      renderComponent("sink", sampleGraph, emptyRuntime);
      expect(screen.getByText("产线运行后，成品将在这里展示。")).toBeInTheDocument();
    });

    it("空状态有 product--empty class", () => {
      renderComponent("sink", sampleGraph, emptyRuntime);
      expect(document.querySelector(".product--empty")).toBeInTheDocument();
    });
  });

  describe("渲染", () => {
    it("显示'成品'标签", () => {
      renderComponent();
      expect(screen.getByText("成品")).toBeInTheDocument();
    });

    it("显示产线名称", () => {
      renderComponent();
      expect(screen.getByText("小红书种草笔记")).toBeInTheDocument();
    });

    it("产线名称为空时显示'未命名流水线'", () => {
      const graph = { ...sampleGraph, name: undefined };
      renderComponent("sink", graph as any);
      expect(screen.getByText("未命名流水线")).toBeInTheDocument();
    });

    it("显示导出按钮组", () => {
      renderComponent();
      expect(screen.getByText("HTML")).toBeInTheDocument();
      expect(screen.getByText("MD")).toBeInTheDocument();
      expect(screen.getByText("长图")).toBeInTheDocument();
    });

    it("显示复制按钮组", () => {
      renderComponent();
      expect(screen.getByText("富文本")).toBeInTheDocument();
      expect(screen.getByText("原文")).toBeInTheDocument();
    });

    it("显示上游产物卡片", () => {
      renderComponent();
      expect(screen.getByTestId("artifact-a1")).toBeInTheDocument();
      expect(screen.getByTestId("artifact-a2")).toBeInTheDocument();
    });

    it("显示成品正文（markdown）", () => {
      renderComponent();
      expect(screen.getByTestId("markdown-rendered")).toBeInTheDocument();
    });

    it("product-json 文本使用 ProductBlocks 渲染", () => {
      const runtime = {
        ...sampleRuntime,
        nodes: {
          ...sampleRuntime.nodes,
          sink: {
            status: "done",
            outputs: { 0: '```product-json\n{"blocks":[]}\n```' },
            artifacts: [],
          },
        },
      } as any;
      renderComponent("sink", sampleGraph, runtime);
      expect(screen.getByTestId("product-blocks")).toBeInTheDocument();
    });
  });

  describe("复制原文", () => {
    it("点击'原文'按钮调用 clipboard.writeText", () => {
      renderComponent();
      fireEvent.click(screen.getByText("原文"));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "# 成品标题\n\n这是成品内容。",
      );
    });

    it("复制后按钮显示'已复制'", () => {
      renderComponent();
      fireEvent.click(screen.getByText("原文"));
      expect(screen.getByText("已复制")).toBeInTheDocument();
    });

    it("1.5秒后按钮恢复为'原文'", async () => {
      renderComponent();
      fireEvent.click(screen.getByText("原文"));
      expect(screen.getByText("已复制")).toBeInTheDocument();
      await waitFor(
        () => {
          expect(screen.getByText("原文")).toBeInTheDocument();
        },
        { timeout: 2000 },
      );
    });
  });

  describe("复制富文本", () => {
    it("点击'富文本'按钮调用 clipboard", async () => {
      renderComponent();
      fireEvent.click(screen.getByText("富文本"));
      await waitFor(() => {
        // 可能走 write（ClipboardItem）或 writeText（catch/else 分支）
        expect(
          navigator.clipboard.write.mock.calls.length > 0 ||
            navigator.clipboard.writeText.mock.calls.length > 0,
        ).toBe(true);
      });
    });

    it("复制后按钮显示'已复制'", async () => {
      renderComponent();
      fireEvent.click(screen.getByText("富文本"));
      await waitFor(() => {
        expect(screen.getByText("已复制")).toBeInTheDocument();
      });
    });
  });

  describe("下载", () => {
    it("点击 HTML 按钮触发下载", () => {
      renderComponent();
      fireEvent.click(screen.getByText("HTML"));
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });

    it("点击 MD 按钮触发下载", () => {
      renderComponent();
      fireEvent.click(screen.getByText("MD"));
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });

    it("点击长图按钮触发下载", async () => {
      renderComponent();
      fireEvent.click(screen.getByText("长图"));
      await waitFor(() => {
        expect(screen.getByText("长图")).toBeInTheDocument();
      });
    });

    it("长图生成中按钮显示'生成中…'", () => {
      renderComponent();
      fireEvent.click(screen.getByText("长图"));
      expect(screen.getByText("生成中…")).toBeInTheDocument();
    });

    it("长图生成中按钮被禁用", () => {
      renderComponent();
      fireEvent.click(screen.getByText("长图"));
      const button = screen.getByText("生成中…").closest("button");
      expect(button).toBeDisabled();
    });
  });

  describe("上游产物收集", () => {
    it("收集所有上游节点的产物", () => {
      renderComponent();
      // textgen 和 imagegen 都有产物
      expect(screen.getByTestId("artifact-a1")).toBeInTheDocument();
      expect(screen.getByTestId("artifact-a2")).toBeInTheDocument();
    });

    it("过滤掉 product-json 文本产物", () => {
      const runtime = {
        ...sampleRuntime,
        nodes: {
          ...sampleRuntime.nodes,
          textgen: {
            status: "done",
            artifacts: [
              {
                id: "a3",
                kind: "text",
                content: '```product-json\n{"blocks":[]}\n```',
                mime: "text/plain",
              },
            ],
          },
        },
      } as any;
      renderComponent("sink", sampleGraph, runtime);
      // product-json 文本应该被过滤掉，不显示
      expect(screen.queryByTestId("artifact-a3")).not.toBeInTheDocument();
    });
  });
});
