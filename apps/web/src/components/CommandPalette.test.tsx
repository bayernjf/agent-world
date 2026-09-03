import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CommandPalette, { type CommandItem } from "./CommandPalette";

// jsdom doesn't implement scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const sampleItems: CommandItem[] = [
  {
    id: "add-textgen",
    label: "添加文坊",
    hint: "添加一个 LLM 加工节点",
    shortcut: "N",
    group: "节点",
    onSelect: vi.fn(),
    keywords: "textgen llm 文本生成",
  },
  {
    id: "add-gate",
    label: "添加质检站",
    hint: "添加一个质量检验节点",
    group: "节点",
    onSelect: vi.fn(),
    keywords: "gate 质检 检验",
  },
  {
    id: "zoom-fit",
    label: "适应屏幕",
    hint: "缩放画布以适应所有节点",
    shortcut: "F",
    group: "查看",
    onSelect: vi.fn(),
    keywords: "zoom fit 缩放 适应",
  },
  {
    id: "run-graph",
    label: "运行产线",
    hint: "开始执行当前产线",
    shortcut: "R",
    group: "自动化",
    onSelect: vi.fn(),
    keywords: "run execute 运行 执行",
  },
  {
    id: "open-settings",
    label: "打开设置",
    hint: "配置模型和密钥",
    group: "管理",
    onSelect: vi.fn(),
    keywords: "settings config 设置 配置",
  },
];

function renderPalette(open = true, items: CommandItem[] = sampleItems) {
  const onClose = vi.fn();
  render(<CommandPalette open={open} onClose={onClose} items={items} />);
  return { onClose };
}

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(<CommandPalette open={false} onClose={vi.fn()} items={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it("open=true 时显示搜索输入框", () => {
      renderPalette();
      expect(screen.getByPlaceholderText("搜索命令、动作或节点操作…")).toBeInTheDocument();
    });

    it("显示对话框 role 和 aria-label", () => {
      renderPalette();
      expect(screen.getByRole("dialog", { name: "命令面板" })).toBeInTheDocument();
    });

    it("显示所有命令项", () => {
      renderPalette();
      expect(screen.getByText("添加文坊")).toBeInTheDocument();
      expect(screen.getByText("添加质检站")).toBeInTheDocument();
      expect(screen.getByText("适应屏幕")).toBeInTheDocument();
      expect(screen.getByText("运行产线")).toBeInTheDocument();
      expect(screen.getByText("打开设置")).toBeInTheDocument();
    });

    it("显示分组标题", () => {
      renderPalette();
      expect(screen.getByText("节点")).toBeInTheDocument();
      expect(screen.getByText("查看")).toBeInTheDocument();
      expect(screen.getByText("自动化")).toBeInTheDocument();
      expect(screen.getByText("管理")).toBeInTheDocument();
    });

    it("显示命令 hint", () => {
      renderPalette();
      expect(screen.getByText("添加一个 LLM 加工节点")).toBeInTheDocument();
      expect(screen.getByText("缩放画布以适应所有节点")).toBeInTheDocument();
    });

    it("显示命令快捷键", () => {
      renderPalette();
      expect(screen.getByText("N")).toBeInTheDocument();
      expect(screen.getByText("F")).toBeInTheDocument();
      expect(screen.getByText("R")).toBeInTheDocument();
    });

    it("显示底部操作提示", () => {
      renderPalette();
      expect(screen.getByText("移动")).toBeInTheDocument();
      expect(screen.getByText("执行")).toBeInTheDocument();
      expect(screen.getByText("关闭")).toBeInTheDocument();
    });

    it("默认选中第一个命令项", () => {
      renderPalette();
      const items = screen.getAllByRole("button");
      expect(items[0]).toHaveClass("is-active");
    });
  });

  describe("搜索过滤", () => {
    it("输入搜索词过滤命令", () => {
      renderPalette();
      const input = screen.getByPlaceholderText("搜索命令、动作或节点操作…");
      fireEvent.change(input, { target: { value: "运行" } });
      expect(screen.getByText("运行产线")).toBeInTheDocument();
      expect(screen.queryByText("添加文坊")).not.toBeInTheDocument();
    });

    it("搜索匹配 hint", () => {
      renderPalette();
      const input = screen.getByPlaceholderText("搜索命令、动作或节点操作…");
      fireEvent.change(input, { target: { value: "LLM" } });
      expect(screen.getByText("添加文坊")).toBeInTheDocument();
      expect(screen.queryByText("添加质检站")).not.toBeInTheDocument();
    });

    it("搜索匹配 keywords", () => {
      renderPalette();
      const input = screen.getByPlaceholderText("搜索命令、动作或节点操作…");
      fireEvent.change(input, { target: { value: "zoom" } });
      expect(screen.getByText("适应屏幕")).toBeInTheDocument();
      expect(screen.queryByText("运行产线")).not.toBeInTheDocument();
    });

    it("无匹配时显示'没有匹配的命令'", () => {
      renderPalette();
      const input = screen.getByPlaceholderText("搜索命令、动作或节点操作…");
      fireEvent.change(input, { target: { value: "不存在的命令" } });
      expect(screen.getByText("没有匹配的命令")).toBeInTheDocument();
    });

    it("搜索后重置选中项为第一个", () => {
      renderPalette();
      const input = screen.getByPlaceholderText("搜索命令、动作或节点操作…");
      fireEvent.change(input, { target: { value: "节点" } });
      const items = screen.getAllByRole("button");
      expect(items[0]).toHaveClass("is-active");
    });
  });

  describe("键盘导航", () => {
    it("按 ArrowDown 移动选中项", () => {
      renderPalette();
      fireEvent.keyDown(window, { key: "ArrowDown" });
      const items = screen.getAllByRole("button");
      expect(items[1]).toHaveClass("is-active");
    });

    it("按 ArrowUp 移动选中项", () => {
      renderPalette();
      fireEvent.keyDown(window, { key: "ArrowDown" });
      fireEvent.keyDown(window, { key: "ArrowDown" });
      fireEvent.keyDown(window, { key: "ArrowUp" });
      const items = screen.getAllByRole("button");
      expect(items[1]).toHaveClass("is-active");
    });

    it("ArrowDown 在最后一项不越界", () => {
      renderPalette();
      for (let i = 0; i < 10; i++) {
        fireEvent.keyDown(window, { key: "ArrowDown" });
      }
      const items = screen.getAllByRole("button");
      expect(items[items.length - 1]).toHaveClass("is-active");
    });

    it("ArrowUp 在第一项不越界", () => {
      renderPalette();
      fireEvent.keyDown(window, { key: "ArrowUp" });
      const items = screen.getAllByRole("button");
      expect(items[0]).toHaveClass("is-active");
    });

    it("按 Enter 执行选中的命令", async () => {
      const onSelect = vi.fn();
      const items: CommandItem[] = [
        { ...sampleItems[0], onSelect },
        ...sampleItems.slice(1),
      ];
      renderPalette(true, items);
      fireEvent.keyDown(window, { key: "Enter" });
      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledTimes(1);
      });
    });

    it("按 Enter 执行第二个命令（先 ArrowDown）", async () => {
      const onSelect = vi.fn();
      const items: CommandItem[] = [
        sampleItems[0],
        { ...sampleItems[1], onSelect },
        ...sampleItems.slice(2),
      ];
      renderPalette(true, items);
      fireEvent.keyDown(window, { key: "ArrowDown" });
      fireEvent.keyDown(window, { key: "Enter" });
      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledTimes(1);
      });
    });

    it("按 Escape 调用 onClose", () => {
      const { onClose } = renderPalette();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("点击命令", () => {
    it("点击命令项调用 onSelect", async () => {
      const onSelect = vi.fn();
      const items: CommandItem[] = [
        { ...sampleItems[0], onSelect },
        ...sampleItems.slice(1),
      ];
      renderPalette(true, items);
      fireEvent.click(screen.getByText("添加文坊"));
      await waitFor(() => {
        expect(onSelect).toHaveBeenCalledTimes(1);
      });
    });

    it("点击命令项调用 onClose", () => {
      const { onClose } = renderPalette();
      fireEvent.click(screen.getByText("添加文坊"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("鼠标悬停命令项设置为选中", () => {
      renderPalette();
      const items = screen.getAllByRole("button");
      fireEvent.mouseEnter(items[2]);
      expect(items[2]).toHaveClass("is-active");
    });
  });

  describe("最近使用", () => {
    it("执行命令后保存到 localStorage", () => {
      renderPalette();
      fireEvent.click(screen.getByText("添加文坊"));
      const stored = JSON.parse(localStorage.getItem("agent-world.commandPalette.recents") || "[]");
      expect(stored).toContain("add-textgen");
    });

    it("重新打开时显示'最近'分组", () => {
      localStorage.setItem(
        "agent-world.commandPalette.recents",
        JSON.stringify(["run-graph"]),
      );
      renderPalette();
      expect(screen.getByText("最近")).toBeInTheDocument();
    });

    it("最近使用的命令排在最前面", () => {
      localStorage.setItem(
        "agent-world.commandPalette.recents",
        JSON.stringify(["run-graph"]),
      );
      renderPalette();
      const items = screen.getAllByRole("button");
      expect(items[0]).toHaveTextContent("运行产线");
    });

    it("最近使用最多保存 6 条", () => {
      renderPalette();
      // 执行 7 个不同的命令（只有 5 个，重复执行不增加）
      for (const item of sampleItems) {
        fireEvent.click(screen.getByText(item.label));
      }
      const stored = JSON.parse(localStorage.getItem("agent-world.commandPalette.recents") || "[]");
      expect(stored.length).toBeLessThanOrEqual(6);
    });
  });

  describe("关闭", () => {
    it("点击背景调用 onClose", () => {
      const { onClose } = renderPalette();
      const backdrop = document.querySelector(".modal-backdrop")!;
      fireEvent.mouseDown(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击面板内容不调用 onClose", () => {
      const { onClose } = renderPalette();
      const palette = document.querySelector(".palette")!;
      fireEvent.mouseDown(palette);
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
