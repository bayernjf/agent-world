import { render, screen, fireEvent } from "@testing-library/react";
import ShortcutsHelp from "./ShortcutsHelp";

// Mock Popover
vi.mock("./Popover", () => ({
  default: ({ open, anchor, placement, className, children }: any) => {
    if (!open || !anchor) return null;
    return (
      <div data-testid="popover" data-placement={placement} className={className}>
        {children}
      </div>
    );
  },
}));

// Mock getBoundingClientRect
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: 100,
      left: 200,
      width: 80,
      height: 30,
      bottom: 130,
      right: 280,
      x: 200,
      y: 100,
      toJSON: () => {},
    }),
  });
});

describe("ShortcutsHelp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("渲染", () => {
    it("显示'快捷键 ?'按钮", () => {
      render(<ShortcutsHelp />);
      expect(screen.getByRole("button", { name: "快捷键 ?" })).toBeInTheDocument();
    });

    it("有 shortcuts class", () => {
      render(<ShortcutsHelp />);
      expect(document.querySelector(".shortcuts")).toBeInTheDocument();
    });

    it("按钮有 shortcuts__trigger class", () => {
      render(<ShortcutsHelp />);
      expect(document.querySelector(".shortcuts__trigger")).toBeInTheDocument();
    });

    it("初始状态不显示 Popover", () => {
      render(<ShortcutsHelp />);
      expect(screen.queryByTestId("popover")).not.toBeInTheDocument();
    });
  });

  describe("鼠标悬停", () => {
    it("鼠标进入时显示 Popover", () => {
      render(<ShortcutsHelp />);
      fireEvent.mouseEnter(document.querySelector(".shortcuts")!);
      expect(screen.getByTestId("popover")).toBeInTheDocument();
    });

    it("鼠标离开时关闭 Popover", () => {
      render(<ShortcutsHelp />);
      fireEvent.mouseEnter(document.querySelector(".shortcuts")!);
      expect(screen.getByTestId("popover")).toBeInTheDocument();
      fireEvent.mouseLeave(document.querySelector(".shortcuts")!);
      expect(screen.queryByTestId("popover")).not.toBeInTheDocument();
    });

    it("Popover placement 为 bottom", () => {
      render(<ShortcutsHelp />);
      fireEvent.mouseEnter(document.querySelector(".shortcuts")!);
      expect(screen.getByTestId("popover")).toHaveAttribute("data-placement", "bottom");
    });

    it("Popover 有 shortcuts__pop class", () => {
      render(<ShortcutsHelp />);
      fireEvent.mouseEnter(document.querySelector(".shortcuts")!);
      expect(screen.getByTestId("popover").classList.contains("shortcuts__pop")).toBe(true);
    });
  });

  describe("聚焦", () => {
    it("聚焦时显示 Popover", () => {
      render(<ShortcutsHelp />);
      fireEvent.focus(document.querySelector(".shortcuts")!);
      expect(screen.getByTestId("popover")).toBeInTheDocument();
    });

    it("失焦时关闭 Popover", () => {
      render(<ShortcutsHelp />);
      fireEvent.focus(document.querySelector(".shortcuts")!);
      expect(screen.getByTestId("popover")).toBeInTheDocument();
      fireEvent.blur(document.querySelector(".shortcuts")!);
      expect(screen.queryByTestId("popover")).not.toBeInTheDocument();
    });
  });

  describe("点击按钮", () => {
    it("点击按钮不报错", () => {
      render(<ShortcutsHelp />);
      expect(() => {
        fireEvent.click(screen.getByRole("button", { name: "快捷键 ?" }));
      }).not.toThrow();
    });
  });

  describe("快捷键内容", () => {
    beforeEach(() => {
      render(<ShortcutsHelp />);
      fireEvent.mouseEnter(document.querySelector(".shortcuts")!);
    });

    it("显示'快捷键'标题", () => {
      expect(screen.getByText("快捷键")).toBeInTheDocument();
    });

    it("显示画布分组", () => {
      expect(screen.getByText("画布")).toBeInTheDocument();
    });

    it("显示编辑分组", () => {
      expect(screen.getByText("编辑")).toBeInTheDocument();
    });

    it("显示工具分组", () => {
      expect(screen.getByText("工具")).toBeInTheDocument();
    });

    it("显示其他分组", () => {
      expect(screen.getByText("其他")).toBeInTheDocument();
    });

    it("画布分组包含移动画布", () => {
      expect(screen.getByText("移动画布")).toBeInTheDocument();
    });

    it("画布分组包含缩放画布", () => {
      expect(screen.getByText("缩放画布")).toBeInTheDocument();
    });

    it("画布分组包含方向键平移", () => {
      expect(screen.getByText(/方向键平移画布/)).toBeInTheDocument();
    });

    it("画布分组包含 F 键居中", () => {
      expect(screen.getByText("缩放并居中到选中节点")).toBeInTheDocument();
    });

    it("编辑分组包含复制", () => {
      expect(screen.getByText("复制选中节点")).toBeInTheDocument();
    });

    it("编辑分组包含粘贴", () => {
      expect(screen.getByText(/粘贴节点/)).toBeInTheDocument();
    });

    it("编辑分组包含撤销", () => {
      expect(screen.getByText("撤销")).toBeInTheDocument();
    });

    it("编辑分组包含重做", () => {
      expect(screen.getByText("重做")).toBeInTheDocument();
    });

    it("编辑分组包含删除", () => {
      expect(screen.getByText("删除选中节点或管道")).toBeInTheDocument();
    });

    it("工具分组包含选择工具", () => {
      expect(screen.getByText(/拖动节点/)).toBeInTheDocument();
    });

    it("工具分组包含连线工具", () => {
      expect(screen.getByText(/依次点两个节点/)).toBeInTheDocument();
    });

    it("工具分组包含返工工具", () => {
      expect(screen.getByText(/建立回退管道/)).toBeInTheDocument();
    });

    it("工具分组包含拆除工具", () => {
      expect(screen.getByText(/点击节点或管道删除/)).toBeInTheDocument();
    });

    it("其他分组包含悬停节点", () => {
      expect(screen.getByText(/查看模型/)).toBeInTheDocument();
    });

    it("其他分组包含悬停管道", () => {
      expect(screen.getByText(/高亮整条上下游流向/)).toBeInTheDocument();
    });

    it("其他分组包含 T 键", () => {
      expect(screen.getByText(/开启\/关闭节点悬停名牌/)).toBeInTheDocument();
    });

    it("其他分组包含 E 键", () => {
      expect(screen.getByText(/切换详情抽屉/)).toBeInTheDocument();
    });
  });

  describe("结构和样式", () => {
    beforeEach(() => {
      render(<ShortcutsHelp />);
      fireEvent.mouseEnter(document.querySelector(".shortcuts")!);
    });

    it("有 shortcuts__panel class", () => {
      expect(document.querySelector(".shortcuts__panel")).toBeInTheDocument();
    });

    it("有 shortcuts__head class", () => {
      expect(document.querySelector(".shortcuts__head")).toBeInTheDocument();
    });

    it("有 shortcuts__grid class", () => {
      expect(document.querySelector(".shortcuts__grid")).toBeInTheDocument();
    });

    it("有 4 个 shortcuts__group", () => {
      expect(document.querySelectorAll(".shortcuts__group").length).toBe(4);
    });

    it("有 shortcuts__group-title class", () => {
      expect(document.querySelectorAll(".shortcuts__group-title").length).toBe(4);
    });

    it("有 shortcuts__row class", () => {
      expect(document.querySelectorAll(".shortcuts__row").length).toBeGreaterThan(0);
    });

    it("有 shortcuts__keys class (kbd)", () => {
      expect(document.querySelectorAll(".shortcuts__keys").length).toBeGreaterThan(0);
    });

    it("有 shortcuts__desc class", () => {
      expect(document.querySelectorAll(".shortcuts__desc").length).toBeGreaterThan(0);
    });

    it("panel 有 role=dialog", () => {
      expect(document.querySelector(".shortcuts__panel")).toHaveAttribute("role", "dialog");
    });

    it("panel 有 aria-label", () => {
      expect(document.querySelector(".shortcuts__panel")).toHaveAttribute("aria-label", "快捷键说明");
    });
  });

  describe("Popover 面板交互", () => {
    it("鼠标进入面板保持打开", () => {
      render(<ShortcutsHelp />);
      fireEvent.mouseEnter(document.querySelector(".shortcuts")!);
      expect(screen.getByTestId("popover")).toBeInTheDocument();
      // 鼠标进入面板
      fireEvent.mouseEnter(document.querySelector(".shortcuts__panel")!);
      expect(screen.getByTestId("popover")).toBeInTheDocument();
    });

    it("鼠标离开面板关闭", () => {
      render(<ShortcutsHelp />);
      fireEvent.mouseEnter(document.querySelector(".shortcuts")!);
      fireEvent.mouseEnter(document.querySelector(".shortcuts__panel")!);
      expect(screen.getByTestId("popover")).toBeInTheDocument();
      fireEvent.mouseLeave(document.querySelector(".shortcuts__panel")!);
      expect(screen.queryByTestId("popover")).not.toBeInTheDocument();
    });
  });
});
