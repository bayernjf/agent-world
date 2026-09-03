import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { useGraph, getModelOptions, refreshDefaultModel } from "../store/graph";
import { useToast } from "../store/toast";
import ModelAssignModal from "./ModelAssignModal";
import type { GraphNode } from "@agent-world/core";

// Mock stores
vi.mock("../store/graph", () => ({
  useGraph: vi.fn(),
  getModelOptions: vi.fn(),
  refreshDefaultModel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../store/toast", () => ({
  useToast: {
    getState: vi.fn(() => ({
      show: vi.fn(),
    })),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockUseGraph = useGraph as unknown as ReturnType<typeof vi.fn>;
const mockGetModelOptions = getModelOptions as unknown as ReturnType<typeof vi.fn>;
const mockAssignModel = vi.fn();
const mockShowToast = vi.fn();

// Sample graph with AI nodes
const sampleGraph = {
  id: "graph-1",
  name: "测试产线",
  nodes: [
    { id: "n1", kind: "textGen", name: "文案生成", x: 0, y: 0, textGen: { model: "gpt-4o" } },
    { id: "n2", kind: "textGen", name: "标题生成", x: 0, y: 0, textGen: { model: "" } },
    { id: "n3", kind: "imageGen", name: "配图生成", x: 0, y: 0, imageGen: { model: "dall-e-3" } },
    { id: "n4", kind: "imageGen", name: "场景图", x: 0, y: 0, imageGen: { model: "" } },
    { id: "n5", kind: "sink", name: "成品库", x: 0, y: 0 },
  ] as GraphNode[],
  edges: [],
};

// Sample model options
const sampleOptions = [
  { provider: "openai", model: "gpt-4o", modality: "text" },
  { provider: "openai", model: "gpt-3.5-turbo", modality: "text" },
  { provider: "openai", model: "dall-e-3", modality: "image" },
  { provider: "stability", model: "sd-xl", modality: "image" },
];

function setupMocks(options = sampleOptions) {
  mockUseGraph.mockImplementation((selector?: (s: unknown) => unknown) => {
    const store = {
      graph: sampleGraph,
      assignModel: mockAssignModel,
    };
    if (selector) return selector(store);
    return store;
  });
  mockGetModelOptions.mockReturnValue(options);
  (useToast as unknown as { getState: () => { show: typeof mockShowToast } }).getState = vi.fn(() => ({
    show: mockShowToast,
  }));
}

function renderModal(open = true) {
  return render(
    <ModelAssignModal
      open={open}
      onClose={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
}

async function renderModalAndWait() {
  renderModal();
  // 等待 useEffect 中的异步模型加载完成
  await screen.findByText("文本模型");
  return;
}

describe("ModelAssignModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = renderModal(false);
      expect(container).toBeEmptyDOMElement();
    });

    it("open=true 时显示模态框标题'模型分配'", () => {
      renderModal();
      expect(screen.getByText("模型分配")).toBeInTheDocument();
    });

    it("显示当前产线名称", () => {
      renderModal();
      expect(screen.getByText(/当前产线：测试产线/)).toBeInTheDocument();
    });

    it("显示关闭按钮", () => {
      renderModal();
      expect(screen.getByRole("button", { name: "✕" })).toBeInTheDocument();
    });

    it("调用 refreshDefaultModel 和 getModelOptions", async () => {
      await renderModalAndWait();
      expect(refreshDefaultModel).toHaveBeenCalledTimes(1);
      expect(getModelOptions).toHaveBeenCalledTimes(1);
    });
  });

  describe("空状态", () => {
    it("没有模型时显示'尚未配置任何可用模型'", () => {
      setupMocks([]);
      renderModal();
      expect(screen.getByText("尚未配置任何可用模型。")).toBeInTheDocument();
    });

    it("没有模型时显示'去设置 · 模型与密钥'按钮", () => {
      setupMocks([]);
      renderModal();
      expect(screen.getByRole("button", { name: "去设置 · 模型与密钥" })).toBeInTheDocument();
    });

    it("没有模型时不显示模型列表", () => {
      setupMocks([]);
      renderModal();
      expect(screen.queryByText("文本模型")).not.toBeInTheDocument();
      expect(screen.queryByText("图片模型")).not.toBeInTheDocument();
    });
  });

  describe("模型列表", () => {
    it("按模态分组显示模型", async () => {
      await renderModalAndWait();
      expect(screen.getByText("文本模型")).toBeInTheDocument();
      expect(screen.getByText("图片模型")).toBeInTheDocument();
    });

    it("显示所有模型名称", async () => {
      await renderModalAndWait();
      expect(screen.getByText("gpt-4o")).toBeInTheDocument();
      expect(screen.getByText("gpt-3.5-turbo")).toBeInTheDocument();
      expect(screen.getByText("dall-e-3")).toBeInTheDocument();
      expect(screen.getByText("sd-xl")).toBeInTheDocument();
    });

    it("显示模型使用节点数", async () => {
      await renderModalAndWait();
      // gpt-4o 和 dall-e-3 都被 1 个节点使用
      expect(screen.getAllByText("1 节点").length).toBeGreaterThan(0);
      // gpt-3.5-turbo 和 sd-xl 未被使用
      expect(screen.getAllByText("未使用").length).toBeGreaterThan(0);
    });

    it("不显示没有模型的模态分组", async () => {
      await renderModalAndWait();
      // 没有 video 和 audio 模型，不应该显示这些分组
      expect(screen.queryByText("视频模型")).not.toBeInTheDocument();
      expect(screen.queryByText("音频模型")).not.toBeInTheDocument();
    });
  });

  describe("选择模型", () => {
    it("未选择模型时显示提示文字", async () => {
      await renderModalAndWait();
      expect(screen.getByText("点击左侧模型，查看当前产线中可指派的节点。")).toBeInTheDocument();
    });

    it("点击模型后显示候选节点列表", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-3.5-turbo"));
      // 应该显示两个 textGen 节点
      expect(screen.getByText("文案生成")).toBeInTheDocument();
      expect(screen.getByText("标题生成")).toBeInTheDocument();
    });

    it("点击模型后默认勾选非同模型节点", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-3.5-turbo"));
      // 文案生成已用 gpt-4o，应该被勾选
      // 标题生成未配置模型，应该被勾选
      const copyNode = screen.getByText("文案生成").closest("button")!;
      const titleNode = screen.getByText("标题生成").closest("button")!;
      expect(copyNode).toHaveClass("is-on");
      expect(titleNode).toHaveClass("is-on");
    });

    it("点击模型后显示模态徽章和模型名", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-3.5-turbo"));
      // 模态徽章在 .modality-badge 中
      const badge = document.querySelector(".modality-badge")!;
      expect(badge).toHaveTextContent("文本");
      // 选中的模型名在 .model-assign__picked 中
      expect(document.querySelector(".model-assign__picked")).toHaveTextContent("gpt-3.5-turbo");
    });

    it("选择图片模型后只显示图片节点", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("sd-xl"));
      expect(screen.getByText("配图生成")).toBeInTheDocument();
      expect(screen.getByText("场景图")).toBeInTheDocument();
      // 不应该显示文本节点
      expect(screen.queryByText("文案生成")).not.toBeInTheDocument();
    });

    it("选中的模型按钮有 is-on 样式", async () => {
      await renderModalAndWait();
      const modelBtn = screen.getByText("gpt-3.5-turbo").closest("button")!;
      fireEvent.click(modelBtn);
      expect(modelBtn).toHaveClass("is-on");
    });
  });

  describe("节点勾选", () => {
    it("点击节点切换勾选状态", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-3.5-turbo"));
      // 标题生成默认被勾选，点击取消
      const titleNode = screen.getByText("标题生成").closest("button")!;
      fireEvent.click(titleNode);
      expect(titleNode).not.toHaveClass("is-on");
      // 再点击勾选
      fireEvent.click(titleNode);
      expect(titleNode).toHaveClass("is-on");
    });

    it("已使用该模型的节点被禁用", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-4o"));
      // 文案生成已用 gpt-4o，应该被禁用
      const copyNode = screen.getByText("文案生成").closest("button")!;
      expect(copyNode).toBeDisabled();
      expect(copyNode).toHaveClass("is-same");
    });

    it("已使用该模型的节点显示'已使用'", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-4o"));
      expect(screen.getByText("已使用")).toBeInTheDocument();
    });

    it("未配置模型的节点显示'(未配置)'", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-4o"));
      // 标题生成未配置模型
      expect(screen.getByText("(未配置)")).toBeInTheDocument();
    });

    it("全选按钮勾选所有可分配节点", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-3.5-turbo"));
      // 先取消所有勾选
      fireEvent.click(screen.getByRole("button", { name: "清空" }));
      // 再全选
      fireEvent.click(screen.getByRole("button", { name: "全选" }));
      // 两个节点都应该被勾选
      const copyNode = screen.getByText("文案生成").closest("button")!;
      const titleNode = screen.getByText("标题生成").closest("button")!;
      expect(copyNode).toHaveClass("is-on");
      expect(titleNode).toHaveClass("is-on");
    });

    it("清空按钮取消所有勾选", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-3.5-turbo"));
      // 默认两个节点都被勾选
      fireEvent.click(screen.getByRole("button", { name: "清空" }));
      const copyNode = screen.getByText("文案生成").closest("button")!;
      const titleNode = screen.getByText("标题生成").closest("button")!;
      expect(copyNode).not.toHaveClass("is-on");
      expect(titleNode).not.toHaveClass("is-on");
    });

    it("全选/清空按钮文本根据状态切换", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-3.5-turbo"));
      // 默认全选，按钮显示"清空"
      expect(screen.getByRole("button", { name: "清空" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "清空" }));
      // 清空后按钮显示"全选"
      expect(screen.getByRole("button", { name: "全选" })).toBeInTheDocument();
    });
  });

  describe("确认应用", () => {
    it("未选择模型时确认按钮被禁用", async () => {
      await renderModalAndWait();
      expect(screen.getByRole("button", { name: "确认应用" })).toBeDisabled();
    });

    it("未勾选节点时确认按钮被禁用", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-3.5-turbo"));
      fireEvent.click(screen.getByRole("button", { name: "清空" }));
      expect(screen.getByRole("button", { name: "确认应用" })).toBeDisabled();
    });

    it("勾选节点后确认按钮可用", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-3.5-turbo"));
      expect(screen.getByRole("button", { name: "确认应用" })).not.toBeDisabled();
    });

    it("点击确认应用调用 assignModel", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-3.5-turbo"));
      fireEvent.click(screen.getByRole("button", { name: "确认应用" }));
      expect(mockAssignModel).toHaveBeenCalledTimes(1);
      expect(mockAssignModel).toHaveBeenCalledWith(
        expect.arrayContaining(["n1", "n2"]),
        "gpt-3.5-turbo",
      );
    });

    it("点击确认应用后显示 toast", async () => {
      mockAssignModel.mockReturnValue(2);
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-3.5-turbo"));
      fireEvent.click(screen.getByRole("button", { name: "确认应用" }));
      expect(mockShowToast).toHaveBeenCalledWith(
        "已将 2 个节点切换为 gpt-3.5-turbo",
        { ttlMs: 3500 },
      );
    });

    it("点击确认应用后清空勾选状态", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-3.5-turbo"));
      fireEvent.click(screen.getByRole("button", { name: "确认应用" }));
      // 确认后勾选被清空，按钮应该再次禁用
      expect(screen.getByRole("button", { name: "确认应用" })).toBeDisabled();
    });

    it("底部摘要显示选中节点数和模型名", async () => {
      await renderModalAndWait();
      fireEvent.click(screen.getByText("gpt-3.5-turbo"));
      const summary = document.querySelector(".model-assign__summary")!;
      expect(summary).toHaveTextContent(/将把/);
      expect(summary).toHaveTextContent(/个节点的模型切换为/);
      expect(summary).toHaveTextContent(/gpt-3.5-turbo/);
    });

    it("未选中节点时底部显示'未选中任何节点'", async () => {
      await renderModalAndWait();
      expect(screen.getByText("未选中任何节点")).toBeInTheDocument();
    });
  });

  describe("关闭", () => {
    it("点击关闭按钮调用 onClose", () => {
      const onClose = vi.fn();
      render(
        <ModelAssignModal open onClose={onClose} onOpenSettings={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "✕" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击背景调用 onClose", () => {
      const onClose = vi.fn();
      render(
        <ModelAssignModal open onClose={onClose} onOpenSettings={vi.fn()} />,
      );
      fireEvent.click(document.querySelector(".modal-backdrop")!);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击模态框内容不调用 onClose", () => {
      const onClose = vi.fn();
      render(
        <ModelAssignModal open onClose={onClose} onOpenSettings={vi.fn()} />,
      );
      fireEvent.click(document.querySelector(".modal")!);
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
