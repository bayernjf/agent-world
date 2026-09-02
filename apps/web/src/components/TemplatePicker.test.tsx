import { render, screen, fireEvent, within } from "@testing-library/react";
import TemplatePicker, {
  TemplatePreview,
  TEMPLATE_LIST,
  type TemplatePreviewData,
} from "./TemplatePicker";

// Sample template data for isolated tests
const sampleTemplates: TemplatePreviewData[] = [
  {
    id: "tpl-test-1",
    name: "测试模板 A",
    description: "这是测试模板 A 的描述",
    category: "营销内容",
    fields: [{ key: "topic", label: "主题", placeholder: "输入主题" }],
    nodes: [
      { id: "n1", kind: "source", x: 100, y: 200 },
      { id: "n2", kind: "textGen", x: 300, y: 200 },
      { id: "n3", kind: "sink", x: 500, y: 200 },
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
    ],
  },
  {
    id: "tpl-test-2",
    name: "测试模板 B",
    description: "这是测试模板 B 的描述",
    category: "营销内容",
    fields: [],
    nodes: [
      { id: "m1", kind: "imageGen", x: 200, y: 100 },
      { id: "m2", kind: "sink", x: 400, y: 300 },
    ],
    edges: [{ from: "m1", to: "m2" }],
  },
  {
    id: "tpl-test-3",
    name: "测试模板 C",
    description: "这是测试模板 C 的描述",
    category: "数据分析",
    fields: [],
    nodes: [{ id: "d1", kind: "code", x: 150, y: 150 }],
    edges: [],
  },
];

describe("TEMPLATE_LIST", () => {
  it("不包含空白产线 (tpl-blank)", () => {
    expect(TEMPLATE_LIST.find((t) => t.id === "tpl-blank")).toBeUndefined();
  });

  it("所有模板都有必需字段", () => {
    expect(TEMPLATE_LIST.length).toBeGreaterThan(0);
    TEMPLATE_LIST.forEach((t) => {
      expect(t).toHaveProperty("id");
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("description");
      expect(t).toHaveProperty("category");
      expect(t).toHaveProperty("fields");
      expect(t).toHaveProperty("nodes");
      expect(t).toHaveProperty("edges");
      expect(typeof t.id).toBe("string");
      expect(typeof t.name).toBe("string");
      expect(Array.isArray(t.fields)).toBe(true);
      expect(Array.isArray(t.nodes)).toBe(true);
      expect(Array.isArray(t.edges)).toBe(true);
    });
  });

  it("模板数量为 27（不含空白产线）", () => {
    expect(TEMPLATE_LIST).toHaveLength(27);
  });

  it("每个模板的节点都有 id、kind、x、y", () => {
    TEMPLATE_LIST.forEach((t) => {
      t.nodes.forEach((n) => {
        expect(n).toHaveProperty("id");
        expect(n).toHaveProperty("kind");
        expect(n).toHaveProperty("x");
        expect(n).toHaveProperty("y");
        expect(typeof n.x).toBe("number");
        expect(typeof n.y).toBe("number");
      });
    });
  });
});

describe("TemplatePreview", () => {
  it("空节点时显示'空白'文本", () => {
    const { container } = render(<TemplatePreview nodes={[]} edges={[]} />);
    expect(container.querySelector(".template-preview--empty")).toBeInTheDocument();
    expect(screen.getByText("空白")).toBeInTheDocument();
  });

  it("有节点时渲染 SVG，有正确的 role 和 aria-label", () => {
    const { container } = render(
      <TemplatePreview
        nodes={[{ id: "n1", kind: "source", x: 100, y: 100 }]}
        edges={[]}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label", "模板结构预览");
  });

  it("渲染节点为 rect 元素", () => {
    const { container } = render(
      <TemplatePreview
        nodes={[
          { id: "n1", kind: "source", x: 100, y: 100 },
          { id: "n2", kind: "textGen", x: 300, y: 100 },
        ]}
        edges={[]}
      />,
    );
    const rects = container.querySelectorAll("rect");
    expect(rects).toHaveLength(2);
  });

  it("渲染边为 line 元素", () => {
    const { container } = render(
      <TemplatePreview
        nodes={[
          { id: "n1", kind: "source", x: 100, y: 100 },
          { id: "n2", kind: "sink", x: 300, y: 100 },
        ]}
        edges={[{ from: "n1", to: "n2" }]}
      />,
    );
    const lines = container.querySelectorAll("line");
    expect(lines).toHaveLength(1);
  });

  it("节点按 kind 着色（已知 kind）", () => {
    const { container } = render(
      <TemplatePreview
        nodes={[{ id: "n1", kind: "textGen", x: 100, y: 100 }]}
        edges={[]}
      />,
    );
    const rect = container.querySelector("rect");
    expect(rect).toHaveAttribute("fill", "#3b82f6");
  });

  it("未知 kind 使用默认颜色 #64748b", () => {
    const { container } = render(
      <TemplatePreview
        nodes={[{ id: "n1", kind: "unknownKind", x: 100, y: 100 }]}
        edges={[]}
      />,
    );
    const rect = container.querySelector("rect");
    expect(rect).toHaveAttribute("fill", "#64748b");
  });

  it("viewBox 根据节点边界计算，包含 padding", () => {
    const { container } = render(
      <TemplatePreview
        nodes={[
          { id: "n1", kind: "source", x: 100, y: 200 },
          { id: "n2", kind: "sink", x: 500, y: 400 },
        ]}
        edges={[]}
      />,
    );
    const svg = container.querySelector("svg");
    // minX=100, minY=200, maxX=500, maxY=400, pad=48
    // viewBox = "52 152 496 296"
    expect(svg).toHaveAttribute("viewBox", "52 152 496 296");
  });

  it("引用不存在的节点的边被跳过", () => {
    const { container } = render(
      <TemplatePreview
        nodes={[{ id: "n1", kind: "source", x: 100, y: 100 }]}
        edges={[{ from: "n1", to: "nonexistent" }]}
      />,
    );
    const lines = container.querySelectorAll("line");
    expect(lines).toHaveLength(0);
  });

  it("有 preserveAspectRatio 属性", () => {
    const { container } = render(
      <TemplatePreview
        nodes={[{ id: "n1", kind: "source", x: 100, y: 100 }]}
        edges={[]}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("preserveAspectRatio", "xMidYMid meet");
  });
});

describe("TemplatePicker", () => {
  const mockOnPick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("按分类分组显示模板", () => {
    render(<TemplatePicker templates={sampleTemplates} onPick={mockOnPick} />);
    // 两个分类：营销内容、数据分析
    expect(screen.getByText("营销内容")).toBeInTheDocument();
    expect(screen.getByText("数据分析")).toBeInTheDocument();
  });

  it("每个分类显示正确的模板数量", () => {
    render(<TemplatePicker templates={sampleTemplates} onPick={mockOnPick} />);
    // 营销内容有 2 个，数据分析有 1 个
    const contentSection = screen.getByText("营销内容").closest("section");
    expect(within(contentSection!).getByText("2")).toBeInTheDocument();
    const dataSection = screen.getByText("数据分析").closest("section");
    expect(within(dataSection!).getByText("1")).toBeInTheDocument();
  });

  it("每个模板卡片显示名称和描述", () => {
    render(<TemplatePicker templates={sampleTemplates} onPick={mockOnPick} />);
    expect(screen.getByText("测试模板 A")).toBeInTheDocument();
    expect(screen.getByText("这是测试模板 A 的描述")).toBeInTheDocument();
    expect(screen.getByText("测试模板 B")).toBeInTheDocument();
    expect(screen.getByText("测试模板 C")).toBeInTheDocument();
  });

  it("点击模板卡片调用 onPick 并传入模板 id", () => {
    render(<TemplatePicker templates={sampleTemplates} onPick={mockOnPick} />);
    fireEvent.click(screen.getByText("测试模板 A").closest("button")!);
    expect(mockOnPick).toHaveBeenCalledTimes(1);
    expect(mockOnPick).toHaveBeenCalledWith("tpl-test-1");
  });

  it("blankFirst=true 时显示空白产线卡片", () => {
    render(
      <TemplatePicker templates={sampleTemplates} onPick={mockOnPick} blankFirst />,
    );
    expect(screen.getByText("空白产线")).toBeInTheDocument();
    expect(screen.getByText("从空白画布开始，不预置任何节点，搭建后自由编辑")).toBeInTheDocument();
  });

  it("点击空白产线卡片调用 onPick(undefined)", () => {
    render(
      <TemplatePicker templates={sampleTemplates} onPick={mockOnPick} blankFirst />,
    );
    fireEvent.click(screen.getByText("空白产线").closest("button")!);
    expect(mockOnPick).toHaveBeenCalledTimes(1);
    expect(mockOnPick).toHaveBeenCalledWith(undefined);
  });

  it("blankFirst=false（默认）时不显示空白产线卡片", () => {
    render(<TemplatePicker templates={sampleTemplates} onPick={mockOnPick} />);
    expect(screen.queryByText("空白产线")).not.toBeInTheDocument();
  });

  it("空白产线卡片显示在最前面", () => {
    render(
      <TemplatePicker templates={sampleTemplates} onPick={mockOnPick} blankFirst />,
    );
    const allButtons = screen.getAllByRole("button");
    // 第一个按钮应该是空白产线
    expect(allButtons[0]).toHaveTextContent("空白产线");
  });

  it("cardClass 应用到 picker、grid 和卡片", () => {
    render(
      <TemplatePicker
        templates={sampleTemplates}
        onPick={mockOnPick}
        cardClass="onboarding"
      />,
    );
    expect(screen.getByText("测试模板 A").closest(".template-picker")).toHaveClass(
      "template-picker--onboarding",
    );
    expect(screen.getByText("测试模板 A").closest("button")).toHaveClass(
      "template-card--onboarding",
    );
  });

  it("空模板列表时不渲染任何分类", () => {
    const { container } = render(
      <TemplatePicker templates={[]} onPick={mockOnPick} />,
    );
    expect(container.querySelector(".template-section")).toBeNull();
  });

  it("空白产线卡片的预览图显示'空白'", () => {
    render(
      <TemplatePicker templates={sampleTemplates} onPick={mockOnPick} blankFirst />,
    );
    const blankCard = screen.getByText("空白产线").closest("button")!;
    expect(within(blankCard).getByText("空白")).toBeInTheDocument();
  });

  it("模板卡片包含 SVG 预览图", () => {
    render(<TemplatePicker templates={sampleTemplates} onPick={mockOnPick} />);
    const cardA = screen.getByText("测试模板 A").closest("button")!;
    expect(cardA.querySelector("svg")).toBeInTheDocument();
  });
});
