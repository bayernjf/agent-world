import { render, screen, fireEvent, waitFor as baseWaitFor, within } from "@testing-library/react";
import { api, proxyImageUrl, type StoredArtifact, type RunSummary } from "../lib/api";
import ProductGallery from "./ProductGallery";

// Use 5s timeout for all waitFor calls (default 1s is too short for async data loading)
const waitFor = (cb: () => void) => baseWaitFor(cb, { timeout: 5000 });

// Mock the api module
vi.mock("../lib/api", () => ({
  api: {
    listArtifacts: vi.fn(),
    listRuns: vi.fn(),
    runGraph: vi.fn(),
    getEvents: vi.fn(),
  },
  proxyImageUrl: vi.fn((url: string | null) => url),
}));

// Mock artifact-renderers to avoid complex dependencies
vi.mock("../lib/artifact-renderers", () => ({
  JsonView: ({ data }: { data: unknown }) => (
    <pre data-testid="json-view">{JSON.stringify(data)}</pre>
  ),
  renderMarkdown: (text: string) => <div data-testid="markdown">{text}</div>,
  safeParse: (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  },
}));

// Mock FinishedProduct (complex dependency)
vi.mock("./FinishedProduct", () => ({
  default: ({ sinkId }: { sinkId: string }) => (
    <div data-testid="finished-product">成品渲染: {sinkId}</div>
  ),
}));

// Mock Tooltip
vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockListArtifacts = api.listArtifacts as unknown as ReturnType<typeof vi.fn>;
const mockListRuns = api.listRuns as unknown as ReturnType<typeof vi.fn>;
const mockRunGraph = api.runGraph as unknown as ReturnType<typeof vi.fn>;
const mockGetEvents = api.getEvents as unknown as ReturnType<typeof vi.fn>;

// Sample artifacts
const sampleArtifacts: StoredArtifact[] = [
  {
    id: "art-001",
    kind: "image",
    label: "产品海报",
    uri: "https://example.com/poster.jpg",
    storage: "uri",
    createdAt: 1700000000000,
    sizeBytes: 102400,
    mimeType: "image/jpeg",
    graphName: "小红书种草",
    graphId: "graph-1",
    runId: "run-1",
    nodeId: "node-1",
  },
  {
    id: "art-002",
    kind: "text",
    label: "文案草稿",
    uri: "https://example.com/copy.txt",
    storage: "uri",
    createdAt: 1700000100000,
    sizeBytes: 2048,
    mimeType: "text/plain",
    graphName: "小红书种草",
    graphId: "graph-1",
    runId: "run-1",
    nodeId: "node-2",
  },
  {
    id: "art-003",
    kind: "json",
    label: "数据分析结果",
    uri: "https://example.com/data.json",
    storage: "uri",
    createdAt: 1700000200000,
    sizeBytes: 5120,
    mimeType: "application/json",
    graphName: "数据报表",
    graphId: "graph-2",
    runId: "run-2",
    nodeId: "node-3",
  },
];

const sampleRuns: RunSummary[] = [
  {
    id: "run-abc12345",
    graph_id: "graph-1",
    graph_name: "小红书种草",
    status: "done",
    started_at: 1700000000000,
    ended_at: 1700000030000,
    trigger: "manual",
  },
  {
    id: "run-def67890",
    graph_id: "graph-2",
    graph_name: "数据报表",
    status: "failed",
    started_at: 1700000100000,
    ended_at: 1700000120000,
    trigger: "scheduled",
  },
];

describe("ProductGallery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListArtifacts.mockResolvedValue([]);
    mockListRuns.mockResolvedValue({ runs: [], total: 0 });
    mockRunGraph.mockResolvedValue({ nodes: [], edges: [] });
    mockGetEvents.mockResolvedValue({ state: {} });
  });

  describe("渲染", () => {
    it("open=false 时不渲染任何内容", () => {
      const { container } = render(<ProductGallery open={false} onClose={() => {}} />);
      expect(container).toBeEmptyDOMElement();
    });

    it("open=true 时渲染模态框，标题为'成品库'", () => {
      render(<ProductGallery open onClose={() => {}} />);
      expect(screen.getByText("成品库")).toBeInTheDocument();
    });

    it("显示 8 个类型过滤器", () => {
      render(<ProductGallery open onClose={() => {}} />);
      // 全部、图片、视频、音频、文本、数据、文件、链接
      expect(screen.getByRole("button", { name: "全部" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "图片" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "视频" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "音频" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "文本" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "数据" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "文件" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "链接" })).toBeInTheDocument();
    });

    it("显示 3 个视图切换按钮", () => {
      render(<ProductGallery open onClose={() => {}} />);
      expect(screen.getByRole("button", { name: "按类型" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "按流水线" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "按运行" })).toBeInTheDocument();
    });

    it("默认选中'全部'过滤器和'按类型'视图", () => {
      render(<ProductGallery open onClose={() => {}} />);
      expect(screen.getByRole("button", { name: "全部" })).toHaveClass("is-on");
      expect(screen.getByRole("button", { name: "按类型" })).toHaveClass("is-on");
    });

    it("有关闭按钮", () => {
      const onClose = vi.fn();
      render(<ProductGallery open onClose={onClose} />);
      fireEvent.click(screen.getByRole("button", { name: "✕" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("数据加载", () => {
    it("打开时调用 api.listArtifacts(60, 0)", async () => {
      render(<ProductGallery open onClose={() => {}} />);
      await waitFor(() => {
        expect(mockListArtifacts).toHaveBeenCalledWith(60, 0);
      });
    });

    it("空状态显示'暂无成品'", async () => {
      mockListArtifacts.mockResolvedValue([]);
      render(<ProductGallery open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText(/暂无成品/)).toBeInTheDocument();
      });
    });

    it("加载完成后显示成品卡片", async () => {
      mockListArtifacts.mockResolvedValue(sampleArtifacts);
      render(<ProductGallery open onClose={() => {}} />);
      // image kind only appears once (in card title), text/json appear twice (title + doc thumb)
      expect(await screen.findByText("产品海报", {}, { timeout: 3000 })).toBeInTheDocument();
      expect(screen.getAllByText("文案草稿").length).toBeGreaterThan(0);
      expect(screen.getAllByText("数据分析结果").length).toBeGreaterThan(0);
    });

    it("加载更多按钮在有更多数据时显示", async () => {
      // 返回 60 个（等于 PAGE），表示有更多
      const manyArtifacts = Array.from({ length: 60 }, (_, i) => ({
        ...sampleArtifacts[0],
        id: `art-${i}`,
        label: `产品 ${i}`,
      }));
      mockListArtifacts.mockResolvedValue(manyArtifacts);
      render(<ProductGallery open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "加载更多" })).toBeInTheDocument();
      });
    });

    it("点击加载更多调用 api.listArtifacts(60, 60)", async () => {
      const manyArtifacts = Array.from({ length: 60 }, (_, i) => ({
        ...sampleArtifacts[0],
        id: `art-${i}`,
        label: `产品 ${i}`,
      }));
      mockListArtifacts.mockResolvedValue(manyArtifacts);
      render(<ProductGallery open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "加载更多" })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
      await waitFor(() => {
        expect(mockListArtifacts).toHaveBeenCalledWith(60, 60);
      });
    });
  });

  describe("类型过滤", () => {
    it("点击'图片'过滤器只显示 image kind 的 artifact", async () => {
      mockListArtifacts.mockResolvedValue(sampleArtifacts);
      render(<ProductGallery open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("产品海报")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: "图片" }));
      expect(screen.getByText("产品海报")).toBeInTheDocument();
      expect(screen.queryByText("文案草稿")).not.toBeInTheDocument();
      expect(screen.queryByText("数据分析结果")).not.toBeInTheDocument();
    });

    it("点击'文本'过滤器只显示 text kind 的 artifact", async () => {
      mockListArtifacts.mockResolvedValue(sampleArtifacts);
      render(<ProductGallery open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("产品海报")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: "文本" }));
      // text kind label appears twice (title + doc thumb)
      expect(screen.getAllByText("文案草稿").length).toBeGreaterThan(0);
      expect(screen.queryByText("产品海报")).not.toBeInTheDocument();
    });

    it("切换过滤器后重新加载数据", async () => {
      mockListArtifacts.mockResolvedValue(sampleArtifacts);
      render(<ProductGallery open onClose={() => {}} />);
      await waitFor(() => {
        expect(mockListArtifacts).toHaveBeenCalledTimes(1);
      });
      fireEvent.click(screen.getByRole("button", { name: "图片" }));
      await waitFor(() => {
        expect(mockListArtifacts).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("视图切换", () => {
    it("按流水线视图按 graphName 分组显示", async () => {
      mockListArtifacts.mockResolvedValue(sampleArtifacts);
      render(<ProductGallery open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("产品海报")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: "按流水线" }));
      // 应该显示分组标题
      expect(screen.getByText("小红书种草")).toBeInTheDocument();
      expect(screen.getByText("数据报表")).toBeInTheDocument();
      // 每个分组显示数量
      const xhsSection = screen.getByText("小红书种草").closest("section");
      expect(within(xhsSection!).getByText("2")).toBeInTheDocument();
    });

    it("按运行视图调用 api.listRuns", async () => {
      mockListRuns.mockResolvedValue({ runs: sampleRuns, total: 2 });
      render(<ProductGallery open onClose={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "按运行" }));
      await waitFor(() => {
        expect(mockListRuns).toHaveBeenCalledWith({ limit: 20, offset: 0 });
      });
    });

    it("按运行视图显示运行记录列表", async () => {
      mockListRuns.mockResolvedValue({ runs: sampleRuns, total: 2 });
      render(<ProductGallery open onClose={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "按运行" }));
      await waitFor(() => {
        expect(screen.getByText("小红书种草")).toBeInTheDocument();
        expect(screen.getByText("数据报表")).toBeInTheDocument();
      });
      // 显示运行状态
      expect(screen.getByText("已完成")).toBeInTheDocument();
      expect(screen.getByText("失败")).toBeInTheDocument();
    });

    it("按运行视图空状态显示提示", async () => {
      mockListRuns.mockResolvedValue({ runs: [], total: 0 });
      render(<ProductGallery open onClose={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "按运行" }));
      await waitFor(() => {
        expect(screen.getByText(/暂无运行记录/)).toBeInTheDocument();
      });
    });

    it("按运行视图时隐藏类型过滤器", async () => {
      render(<ProductGallery open onClose={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "按运行" }));
      expect(screen.queryByRole("button", { name: "全部" })).not.toBeInTheDocument();
    });
  });

  describe("GalleryCard 交互", () => {
    it("点击卡片打开详情", async () => {
      mockListArtifacts.mockResolvedValue([sampleArtifacts[0]]);
      render(<ProductGallery open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("产品海报")).toBeInTheDocument();
      });
      const card = screen.getByText("产品海报").closest(".gallery-card")!;
      fireEvent.click(card);
      await waitFor(() => {
        expect(document.querySelector(".gallery-detail")).toBeInTheDocument();
      });
      // Dialog has no aria-label, so find by role and check content within
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText("产品海报")).toBeInTheDocument();
    });

    it("键盘 Enter 打开详情", async () => {
      mockListArtifacts.mockResolvedValue([sampleArtifacts[0]]);
      render(<ProductGallery open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("产品海报")).toBeInTheDocument();
      });
      const card = screen.getByText("产品海报").closest(".gallery-card")!;
      fireEvent.keyDown(card, { key: "Enter" });
      await waitFor(() => {
        expect(document.querySelector(".gallery-detail")).toBeInTheDocument();
      });
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText("产品海报")).toBeInTheDocument();
    });

    it("卡片显示日期和大小", async () => {
      mockListArtifacts.mockResolvedValue(sampleArtifacts);
      render(<ProductGallery open onClose={() => {}} />);
      await waitFor(() => {
        const card = screen.getByText("产品海报").closest(".gallery-card")!;
        // 100KB = 102400 bytes
        expect(within(card).getByText(/100.0 KB/)).toBeInTheDocument();
      });
    });
  });

  describe("ArtifactDetail", () => {
    it("image kind 显示图片", async () => {
      mockListArtifacts.mockResolvedValue([sampleArtifacts[0]]);
      render(<ProductGallery open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("产品海报")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("产品海报").closest(".gallery-card")!);
      await waitFor(() => {
        expect(document.querySelector(".gallery-detail")).toBeInTheDocument();
      });
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByRole("img")).toBeInTheDocument();
    });

    it("显示类型标签、大小、日期、存储方式", async () => {
      mockListArtifacts.mockResolvedValue([sampleArtifacts[0]]);
      render(<ProductGallery open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("产品海报")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("产品海报").closest(".gallery-card")!);
      await waitFor(() => {
        expect(document.querySelector(".gallery-detail")).toBeInTheDocument();
      });
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText("图片")).toBeInTheDocument();
      expect(within(dialog).getByText(/100.0 KB/)).toBeInTheDocument();
      expect(within(dialog).getByText("外链")).toBeInTheDocument();
    });

    it("有关闭按钮", async () => {
      mockListArtifacts.mockResolvedValue([sampleArtifacts[0]]);
      render(<ProductGallery open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("产品海报")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("产品海报").closest(".gallery-card")!);
      await waitFor(() => {
        expect(document.querySelector(".gallery-detail")).toBeInTheDocument();
      });
      const dialog = screen.getByRole("dialog");
      // 详情里有两个"关闭"按钮：✕ 按钮和 footer 中的关闭按钮，取第一个（✕）
      fireEvent.click(within(dialog).getAllByRole("button", { name: "关闭" })[0]);
      await waitFor(() => {
        expect(document.querySelector(".gallery-detail")).not.toBeInTheDocument();
      });
    });

    it("file/uri kind 显示不支持预览提示", async () => {
      const fileArtifact: StoredArtifact = {
        ...sampleArtifacts[0],
        id: "art-file",
        kind: "file",
        label: "PDF 文件",
        uri: "https://example.com/doc.pdf",
      };
      mockListArtifacts.mockResolvedValue([fileArtifact]);
      render(<ProductGallery open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getAllByText("PDF 文件").length).toBeGreaterThan(0);
      });
      fireEvent.click(screen.getAllByText("PDF 文件")[0].closest(".gallery-card")!);
      await waitFor(() => {
        expect(document.querySelector(".gallery-detail")).toBeInTheDocument();
      });
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(/该类型产物不支持内嵌预览/)).toBeInTheDocument();
    });
  });

  describe("键盘和背景关闭", () => {
    it("按 Escape 关闭模态框", () => {
      const onClose = vi.fn();
      render(<ProductGallery open onClose={onClose} />);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击背景关闭模态框", () => {
      const onClose = vi.fn();
      const { container } = render(<ProductGallery open onClose={onClose} />);
      const backdrop = container.querySelector(".modal-backdrop")!;
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击模态框内容不关闭", () => {
      const onClose = vi.fn();
      render(<ProductGallery open onClose={onClose} />);
      const modal = screen.getByText("成品库").closest(".modal")!;
      fireEvent.click(modal);
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
