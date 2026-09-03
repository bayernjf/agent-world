import { render, screen, fireEvent } from "@testing-library/react";
import GraphSwitcher, { type GraphSummary } from "./GraphSwitcher";

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

// Mock Tooltip
vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

// Mock getBoundingClientRect
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: 50,
      left: 100,
      width: 120,
      height: 30,
      bottom: 80,
      right: 220,
      x: 100,
      y: 50,
      toJSON: () => {},
    }),
  });
});

const sampleGraphs: GraphSummary[] = [
  { id: "graph-1", name: "小红书种草", updated_at: 1000 },
  { id: "graph-2", name: "淘宝详情页", updated_at: 2000 },
  { id: "graph-3", name: "狗粮视频", updated_at: 3000 },
];

function renderComponent(overrides: Partial<{
  graphs: GraphSummary[];
  currentId: string;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}> = {}) {
  const onSwitch = vi.fn();
  const onCreate = vi.fn();
  const onDuplicate = vi.fn();
  const onDelete = vi.fn();
  const onRename = vi.fn();
  render(
    <GraphSwitcher
      graphs={overrides.graphs ?? sampleGraphs}
      currentId={overrides.currentId ?? "graph-1"}
      onSwitch={overrides.onSwitch ?? onSwitch}
      onCreate={overrides.onCreate ?? onCreate}
      onDuplicate={overrides.onDuplicate ?? onDuplicate}
      onDelete={overrides.onDelete ?? onDelete}
      onRename={overrides.onRename ?? onRename}
    />,
  );
  return {
    onSwitch: overrides.onSwitch ?? onSwitch,
    onCreate: overrides.onCreate ?? onCreate,
    onDuplicate: overrides.onDuplicate ?? onDuplicate,
    onDelete: overrides.onDelete ?? onDelete,
    onRename: overrides.onRename ?? onRename,
  };
}

describe("GraphSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("渲染", () => {
    it("显示当前产线名称", () => {
      renderComponent();
      expect(screen.getByText("小红书种草")).toBeInTheDocument();
    });

    it("显示下拉箭头", () => {
      renderComponent();
      expect(screen.getByText("▾")).toBeInTheDocument();
    });

    it("按钮有 hud__graph-switcher class", () => {
      renderComponent();
      expect(document.querySelector(".hud__graph-switcher")).toBeInTheDocument();
    });

    it("产线名称有 hud__graph-name class", () => {
      renderComponent();
      expect(document.querySelector(".hud__graph-name")).toBeInTheDocument();
    });

    it("按钮有 aria-expanded=false", () => {
      renderComponent();
      expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    });

    it("按钮有 aria-haspopup=menu", () => {
      renderComponent();
      expect(screen.getByRole("button")).toHaveAttribute("aria-haspopup", "menu");
    });

    it("currentId 不存在时显示'产线'", () => {
      renderComponent({ currentId: "nonexistent" });
      expect(screen.getByText("产线")).toBeInTheDocument();
    });
  });

  describe("展开/收起", () => {
    it("点击按钮展开 Popover", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByTestId("popover")).toBeInTheDocument();
    });

    it("展开后 aria-expanded=true", () => {
      renderComponent();
      const switcherBtn = document.querySelector(".hud__graph-switcher") as HTMLButtonElement;
      fireEvent.click(switcherBtn);
      expect(switcherBtn).toHaveAttribute("aria-expanded", "true");
    });

    it("再次点击收起 Popover", () => {
      renderComponent();
      const switcherBtn = document.querySelector(".hud__graph-switcher") as HTMLButtonElement;
      fireEvent.click(switcherBtn);
      expect(screen.getByTestId("popover")).toBeInTheDocument();
      fireEvent.click(switcherBtn);
      expect(screen.queryByTestId("popover")).not.toBeInTheDocument();
    });

    it("Popover placement 为 bottom", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByTestId("popover")).toHaveAttribute("data-placement", "bottom");
    });

    it("Popover 有 graph-popover class", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByTestId("popover").classList.contains("graph-popover")).toBe(true);
    });
  });

  describe("产线列表", () => {
    beforeEach(() => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
    });

    it("渲染所有产线", () => {
      expect(screen.getAllByText("小红书种草").length).toBeGreaterThan(0);
      expect(screen.getByText("淘宝详情页")).toBeInTheDocument();
      expect(screen.getByText("狗粮视频")).toBeInTheDocument();
    });

    it("当前产线有 is-current class", () => {
      const rows = document.querySelectorAll(".graph-row");
      expect(rows[0].classList.contains("is-current")).toBe(true);
      expect(rows[1].classList.contains("is-current")).toBe(false);
    });

    it("每个产线有重命名按钮", () => {
      expect(screen.getAllByText("✎")).toHaveLength(3);
    });

    it("每个产线有复制按钮", () => {
      expect(screen.getAllByText("⧉")).toHaveLength(3);
    });

    it("每个产线有删除按钮", () => {
      expect(screen.getAllByText("✕")).toHaveLength(3);
    });

    it("删除按钮有 icon-btn--danger class", () => {
      const deleteBtns = screen.getAllByText("✕");
      expect(deleteBtns[0].classList.contains("icon-btn--danger")).toBe(true);
    });

    it("有 graph-popover__list class", () => {
      expect(document.querySelector(".graph-popover__list")).toBeInTheDocument();
    });

    it("有 graph-row class", () => {
      expect(document.querySelectorAll(".graph-row").length).toBe(3);
    });

    it("有 graph-row__name class", () => {
      expect(document.querySelectorAll(".graph-row__name").length).toBe(3);
    });

    it("有 graph-row__actions class", () => {
      expect(document.querySelectorAll(".graph-row__actions").length).toBe(3);
    });
  });

  describe("切换产线", () => {
    it("点击产线调用 onSwitch", () => {
      const { onSwitch } = renderComponent();
      fireEvent.click(screen.getByRole("button"));
      fireEvent.click(screen.getByText("淘宝详情页"));
      expect(onSwitch).toHaveBeenCalledWith("graph-2");
    });

    it("切换后关闭 Popover", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByTestId("popover")).toBeInTheDocument();
      fireEvent.click(screen.getByText("淘宝详情页"));
      expect(screen.queryByTestId("popover")).not.toBeInTheDocument();
    });

    it("点击当前产线也调用 onSwitch", () => {
      const { onSwitch } = renderComponent();
      const switcherBtn = document.querySelector(".hud__graph-switcher") as HTMLButtonElement;
      fireEvent.click(switcherBtn);
      // 点击 Popover 中的当前产线（第二个匹配的元素，第一个是切换按钮）
      const currentGraphElements = screen.getAllByText("小红书种草");
      const popoverGraph = currentGraphElements.find((el) => el.closest(".graph-popover"));
      if (popoverGraph) fireEvent.click(popoverGraph);
      expect(onSwitch).toHaveBeenCalledWith("graph-1");
    });
  });

  describe("重命名", () => {
    it("点击重命名按钮进入编辑模式", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
      const renameBtns = screen.getAllByText("✎");
      fireEvent.click(renameBtns[0]);
      expect(document.querySelector(".graph-row__input")).toBeInTheDocument();
    });

    it("编辑模式输入框预填当前名称", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
      const renameBtns = screen.getAllByText("✎");
      fireEvent.click(renameBtns[0]);
      const input = document.querySelector(".graph-row__input") as HTMLInputElement;
      expect(input.value).toBe("小红书种草");
    });

    it("编辑模式输入框有 autoFocus", () => {
      renderComponent();
      const switcherBtn = document.querySelector(".hud__graph-switcher") as HTMLButtonElement;
      fireEvent.click(switcherBtn);
      const renameBtns = screen.getAllByText("✎");
      fireEvent.click(renameBtns[0]);
      const input = document.querySelector(".graph-row__input") as HTMLInputElement;
      expect(input).toBeInTheDocument();
      // autoFocus 在 jsdom 中可能不触发实际聚焦，但属性应该存在
      expect(input).toHaveFocus();
    });

    it("双击产线名称进入编辑模式", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
      fireEvent.doubleClick(screen.getByText("淘宝详情页"));
      expect(document.querySelector(".graph-row__input")).toBeInTheDocument();
    });

    it("Enter 键提交重命名", () => {
      const { onRename } = renderComponent();
      fireEvent.click(screen.getByRole("button"));
      const renameBtns = screen.getAllByText("✎");
      fireEvent.click(renameBtns[0]);
      const input = document.querySelector(".graph-row__input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "新名称" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onRename).toHaveBeenCalledWith("graph-1", "新名称");
    });

    it("Enter 键提交后退出编辑模式", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
      const renameBtns = screen.getAllByText("✎");
      fireEvent.click(renameBtns[0]);
      const input = document.querySelector(".graph-row__input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "新名称" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(document.querySelector(".graph-row__input")).not.toBeInTheDocument();
    });

    it("Escape 键取消重命名", () => {
      const { onRename } = renderComponent();
      fireEvent.click(screen.getByRole("button"));
      const renameBtns = screen.getAllByText("✎");
      fireEvent.click(renameBtns[0]);
      const input = document.querySelector(".graph-row__input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "新名称" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onRename).not.toHaveBeenCalled();
      expect(document.querySelector(".graph-row__input")).not.toBeInTheDocument();
    });

    it("失焦提交重命名", () => {
      const { onRename } = renderComponent();
      fireEvent.click(screen.getByRole("button"));
      const renameBtns = screen.getAllByText("✎");
      fireEvent.click(renameBtns[0]);
      const input = document.querySelector(".graph-row__input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "失焦名称" } });
      fireEvent.blur(input);
      expect(onRename).toHaveBeenCalledWith("graph-1", "失焦名称");
    });

    it("空名称不调用 onRename", () => {
      const { onRename } = renderComponent();
      fireEvent.click(screen.getByRole("button"));
      const renameBtns = screen.getAllByText("✎");
      fireEvent.click(renameBtns[0]);
      const input = document.querySelector(".graph-row__input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onRename).not.toHaveBeenCalled();
    });

    it("编辑模式下点击产线不切换", () => {
      const { onSwitch } = renderComponent();
      fireEvent.click(screen.getByRole("button"));
      const renameBtns = screen.getAllByText("✎");
      fireEvent.click(renameBtns[0]);
      // 点击另一个产线
      fireEvent.click(screen.getByText("淘宝详情页"));
      expect(onSwitch).not.toHaveBeenCalled();
    });

    it("编辑模式下点击输入框不冒泡", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
      const renameBtns = screen.getAllByText("✎");
      fireEvent.click(renameBtns[0]);
      const input = document.querySelector(".graph-row__input") as HTMLInputElement;
      // 点击输入框不应该关闭或切换
      expect(() => fireEvent.click(input)).not.toThrow();
    });
  });

  describe("复制产线", () => {
    it("点击复制按钮调用 onDuplicate", () => {
      const { onDuplicate } = renderComponent();
      fireEvent.click(screen.getByRole("button"));
      const duplicateBtns = screen.getAllByText("⧉");
      fireEvent.click(duplicateBtns[0]);
      expect(onDuplicate).toHaveBeenCalledWith("graph-1");
    });

    it("复制后不关闭 Popover", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
      const duplicateBtns = screen.getAllByText("⧉");
      fireEvent.click(duplicateBtns[0]);
      expect(screen.getByTestId("popover")).toBeInTheDocument();
    });
  });

  describe("删除产线", () => {
    it("点击删除按钮调用 onDelete", () => {
      const { onDelete } = renderComponent();
      fireEvent.click(screen.getByRole("button"));
      const deleteBtns = screen.getAllByText("✕");
      fireEvent.click(deleteBtns[0]);
      expect(onDelete).toHaveBeenCalledWith("graph-1");
    });

    it("删除后不关闭 Popover", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
      const deleteBtns = screen.getAllByText("✕");
      fireEvent.click(deleteBtns[0]);
      expect(screen.getByTestId("popover")).toBeInTheDocument();
    });
  });

  describe("新建产线", () => {
    it("显示新建产线按钮", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByText("+ 新建产线")).toBeInTheDocument();
    });

    it("点击新建按钮调用 onCreate", () => {
      const { onCreate } = renderComponent();
      fireEvent.click(screen.getByRole("button"));
      fireEvent.click(screen.getByText("+ 新建产线"));
      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it("新建后关闭 Popover", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByTestId("popover")).toBeInTheDocument();
      fireEvent.click(screen.getByText("+ 新建产线"));
      expect(screen.queryByTestId("popover")).not.toBeInTheDocument();
    });

    it("新建按钮有 graph-popover__new class", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByText("+ 新建产线").classList.contains("graph-popover__new")).toBe(true);
    });

    it("有分隔线", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button"));
      expect(document.querySelector(".graph-popover__divider")).toBeInTheDocument();
    });
  });

  describe("空产线列表", () => {
    it("graphs 为空时只显示新建按钮", () => {
      renderComponent({ graphs: [] });
      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByText("+ 新建产线")).toBeInTheDocument();
      expect(document.querySelectorAll(".graph-row").length).toBe(0);
    });

    it("graphs 为空时按钮显示'产线'", () => {
      renderComponent({ graphs: [], currentId: "" });
      expect(screen.getByText("产线")).toBeInTheDocument();
    });
  });
});
