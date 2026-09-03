import { render, screen, fireEvent, within } from "@testing-library/react";
import { useGraph } from "../store/graph";
import { useCanvas } from "../store/canvas";
import CanvasToolbar from "./CanvasToolbar";

vi.mock("../store/graph", () => ({
  useGraph: vi.fn(),
}));

vi.mock("../store/canvas", () => ({
  useCanvas: vi.fn(),
}));

const mockAddNode = vi.fn().mockReturnValue({ missingModality: undefined });
const mockOnError = vi.fn();

function setupMocks(viewport = { zoom: 1, panX: 0, panY: 0 }) {
  (useGraph as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: unknown) => unknown) => {
      const store = { addNode: mockAddNode };
      return selector(store);
    },
  );
  (useCanvas as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: unknown) => unknown) => {
      const store = { viewport };
      return selector(store);
    },
  );
}

/** Open the "more" palette and return the dialog element for scoped queries. */
function openPalette() {
  fireEvent.click(screen.getByRole("button", { name: /更多/ }));
  return screen.getByRole("dialog", { name: "节点库" });
}

describe("CanvasToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  describe("渲染", () => {
    it("渲染工具栏，有正确的 role 和 aria-label", () => {
      render(<CanvasToolbar />);
      const toolbar = screen.getByRole("toolbar", { name: "添加节点" });
      expect(toolbar).toBeInTheDocument();
    });

    it("渲染 6 个主要节点快捷按钮", () => {
      render(<CanvasToolbar />);
      expect(screen.getByRole("button", { name: "+ 原料台" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ 文坊" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ 质检站" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ 画坊" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ API 口岸" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ 成品库" })).toBeInTheDocument();
    });

    it("渲染'更多'按钮，有正确的无障碍属性", () => {
      render(<CanvasToolbar />);
      const moreBtn = screen.getByRole("button", { name: /更多/ });
      expect(moreBtn).toBeInTheDocument();
      expect(moreBtn).toHaveAttribute("aria-expanded", "false");
      expect(moreBtn).toHaveAttribute("aria-haspopup", "dialog");
    });

    it("主要节点按钮有正确的 title（hint）", () => {
      render(<CanvasToolbar />);
      expect(screen.getByRole("button", { name: "+ 文坊" })).toHaveAttribute(
        "title",
        "LLM 文本生成（文坊），可挂技能卡",
      );
      expect(screen.getByRole("button", { name: "+ 画坊" })).toHaveAttribute(
        "title",
        "文字生成图片",
      );
    });
  });

  describe("主要节点按钮", () => {
    it("点击主要节点按钮调用 addNode", () => {
      render(<CanvasToolbar />);
      fireEvent.click(screen.getByRole("button", { name: "+ 文坊" }));
      expect(mockAddNode).toHaveBeenCalledTimes(1);
      expect(mockAddNode).toHaveBeenCalledWith("textGen", expect.any(Number), expect.any(Number));
    });

    it("点击主要节点按钮在视图中心位置添加节点", () => {
      setupMocks({ zoom: 1, panX: 100, panY: 50 });
      render(<CanvasToolbar />);
      fireEvent.click(screen.getByRole("button", { name: "+ 文坊" }));
      // cx = (VIEW_W / 2 - panX) / zoom = (1440/2 - 100) / 1 = 620
      // cy = (VIEW_H / 2 - panY) / zoom = (640/2 - 50) / 1 = 270
      expect(mockAddNode).toHaveBeenCalledWith("textGen", 620, 270);
    });

    it("addNode 返回 missingModality 时调用 onError", () => {
      mockAddNode.mockReturnValueOnce({ missingModality: "image" });
      render(<CanvasToolbar onError={mockOnError} />);
      fireEvent.click(screen.getByRole("button", { name: "+ 画坊" }));
      expect(mockOnError).toHaveBeenCalledTimes(1);
      expect(mockOnError).toHaveBeenCalledWith(
        expect.stringContaining("该节点需要图片模型"),
      );
    });

    it("addNode 不返回 missingModality 时不调用 onError", () => {
      render(<CanvasToolbar onError={mockOnError} />);
      fireEvent.click(screen.getByRole("button", { name: "+ 文坊" }));
      expect(mockOnError).not.toHaveBeenCalled();
    });
  });

  describe("更多面板", () => {
    it("点击'更多'按钮打开节点库面板", () => {
      render(<CanvasToolbar />);
      const dialog = openPalette();
      expect(dialog).toBeInTheDocument();
      const moreBtn = screen.getByRole("button", { name: /更多/ });
      expect(moreBtn).toHaveAttribute("aria-expanded", "true");
    });

    it("打开面板后搜索框自动聚焦", () => {
      render(<CanvasToolbar />);
      openPalette();
      const searchInput = screen.getByRole("textbox", { name: "搜索节点" });
      expect(searchInput).toHaveFocus();
    });

    it("面板显示节点分类分组", () => {
      render(<CanvasToolbar />);
      const dialog = openPalette();
      expect(within(dialog).getByText("AI 加工")).toBeInTheDocument();
      expect(within(dialog).getByText("投料出料")).toBeInTheDocument();
    });

    it("面板显示所有节点类型（不止主要的 6 个）", () => {
      render(<CanvasToolbar />);
      const dialog = openPalette();
      // 这些不在 PRIMARY_KINDS 里，应该在面板中出现
      expect(within(dialog).getByRole("button", { name: /影坊/ })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: /音坊/ })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: /代码工坊/ })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: /翻译间/ })).toBeInTheDocument();
    });

    it("再次点击'更多'按钮关闭面板", () => {
      render(<CanvasToolbar />);
      openPalette();
      expect(screen.getByRole("dialog", { name: "节点库" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /更多/ }));
      expect(screen.queryByRole("dialog", { name: "节点库" })).not.toBeInTheDocument();
    });

    it("按 Escape 关闭面板", () => {
      render(<CanvasToolbar />);
      openPalette();
      expect(screen.getByRole("dialog", { name: "节点库" })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: "节点库" })).not.toBeInTheDocument();
    });

    it("点击面板外关闭面板", () => {
      render(<CanvasToolbar />);
      openPalette();
      expect(screen.getByRole("dialog", { name: "节点库" })).toBeInTheDocument();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("dialog", { name: "节点库" })).not.toBeInTheDocument();
    });
  });

  describe("搜索功能", () => {
    it("输入搜索词按 label 过滤节点", () => {
      render(<CanvasToolbar />);
      const dialog = openPalette();
      const searchInput = within(dialog).getByRole("textbox", { name: "搜索节点" });
      fireEvent.change(searchInput, { target: { value: "文坊" } });
      // 应该只显示文坊
      expect(within(dialog).getByRole("button", { name: /文坊/ })).toBeInTheDocument();
      expect(within(dialog).queryByRole("button", { name: /画坊/ })).not.toBeInTheDocument();
    });

    it("输入搜索词按 hint 过滤节点", () => {
      render(<CanvasToolbar />);
      const dialog = openPalette();
      const searchInput = within(dialog).getByRole("textbox", { name: "搜索节点" });
      fireEvent.change(searchInput, { target: { value: "PDF" } });
      // 拆包台（提取 PDF/Word/PPT）和换装台（PDF 提图）应该匹配
      expect(within(dialog).getByRole("button", { name: /拆包台/ })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: /换装台/ })).toBeInTheDocument();
    });

    it("输入搜索词按 kind 过滤节点", () => {
      render(<CanvasToolbar />);
      const dialog = openPalette();
      const searchInput = within(dialog).getByRole("textbox", { name: "搜索节点" });
      fireEvent.change(searchInput, { target: { value: "imageGen" } });
      expect(within(dialog).getByRole("button", { name: /画坊/ })).toBeInTheDocument();
    });

    it("搜索无结果时显示空状态", () => {
      render(<CanvasToolbar />);
      const dialog = openPalette();
      const searchInput = within(dialog).getByRole("textbox", { name: "搜索节点" });
      fireEvent.change(searchInput, { target: { value: "不存在的节点xyz" } });
      expect(within(dialog).getByText("没有匹配的节点")).toBeInTheDocument();
    });

    it("搜索不区分大小写", () => {
      render(<CanvasToolbar />);
      const dialog = openPalette();
      const searchInput = within(dialog).getByRole("textbox", { name: "搜索节点" });
      fireEvent.change(searchInput, { target: { value: "IMAGEGEN" } });
      expect(within(dialog).getByRole("button", { name: /画坊/ })).toBeInTheDocument();
    });
  });

  describe("从面板添加节点", () => {
    it("点击面板中的节点调用 addNode 并关闭面板", () => {
      render(<CanvasToolbar />);
      const dialog = openPalette();
      fireEvent.click(within(dialog).getByRole("button", { name: /代码工坊/ }));
      expect(mockAddNode).toHaveBeenCalledTimes(1);
      expect(mockAddNode).toHaveBeenCalledWith("code", expect.any(Number), expect.any(Number));
      expect(screen.queryByRole("dialog", { name: "节点库" })).not.toBeInTheDocument();
    });

    it("点击面板中的节点后清空搜索词", () => {
      render(<CanvasToolbar />);
      const dialog = openPalette();
      const searchInput = within(dialog).getByRole("textbox", { name: "搜索节点" });
      fireEvent.change(searchInput, { target: { value: "代码" } });
      fireEvent.click(within(dialog).getByRole("button", { name: /代码工坊/ }));
      // 重新打开面板，搜索词应该被清空
      const newDialog = openPalette();
      const newSearchInput = within(newDialog).getByRole("textbox", { name: "搜索节点" });
      expect(newSearchInput).toHaveValue("");
    });

    it("面板中的节点按钮有正确的 title 和 hint 文本", () => {
      render(<CanvasToolbar />);
      const dialog = openPalette();
      const codeBtn = within(dialog).getByRole("button", { name: /代码工坊/ });
      expect(codeBtn).toHaveAttribute("title", "跑 JS / Python 脚本（代码工坊）");
      // hint 文本也显示在按钮内
      expect(within(codeBtn).getByText("跑 JS / Python 脚本（代码工坊）")).toBeInTheDocument();
    });
  });
});
