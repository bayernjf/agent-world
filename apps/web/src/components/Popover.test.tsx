import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import Popover, { type Rect } from "./Popover";

// Mock requestAnimationFrame
beforeEach(() => {
  cleanup();
  // Clear any leftover portal content
  document.body.innerHTML = "";
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: any) => {
    cb();
    return 0;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sampleAnchor: Rect = {
  top: 200,
  left: 100,
  width: 200,
  height: 40,
  bottom: 240,
  right: 300,
};

function mockElementRect(width: number, height: number) {
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width,
      height,
      top: 0,
      left: 0,
      bottom: height,
      right: width,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
  });
}

function renderPopover(overrides: Partial<{
  open: boolean;
  anchor: Rect | null;
  placement: "top" | "bottom";
  gap: number;
  margin: number;
  className: string;
  children: React.ReactNode;
}> = {}) {
  return render(
    <Popover
      open={overrides.open ?? true}
      anchor={overrides.anchor ?? sampleAnchor}
      placement={overrides.placement ?? "top"}
      gap={overrides.gap ?? 8}
      margin={overrides.margin ?? 12}
      className={overrides.className ?? ""}
    >
      {overrides.children ?? <div>Popover Content</div>}
    </Popover>,
  );
}

describe("Popover", () => {
  beforeEach(() => {
    // Reset viewport size
    Object.defineProperty(window, "innerWidth", { value: 1024, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 768, writable: true });
    mockElementRect(150, 80);
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = renderPopover({ open: false });
      expect(container.firstChild).toBeNull();
      expect(screen.queryByText("Popover Content")).not.toBeInTheDocument();
    });

    it("anchor=null 时返回 null", () => {
      const { container } = renderPopover({ anchor: null });
      expect(container.firstChild).toBeNull();
    });

    it("open=true 且 anchor 存在时渲染内容", () => {
      renderPopover();
      expect(screen.getByText("Popover Content")).toBeInTheDocument();
    });

    it("通过 Portal 渲染到 document.body", () => {
      const { container } = renderPopover();
      const popover = document.querySelector(".popover");
      expect(popover).toBeInTheDocument();
      expect(popover?.parentElement).toBe(document.body);
      // 不在组件容器内
      expect(container.querySelector(".popover")).toBeNull();
    });

    it("有 popover class", () => {
      renderPopover();
      expect(document.querySelector(".popover")).toBeInTheDocument();
    });

    it("位置计算完成后有 is-ready class", () => {
      renderPopover();
      expect(document.querySelector(".popover")?.classList.contains("is-ready")).toBe(true);
    });

    it("传递自定义 className", () => {
      renderPopover({ className: "custom-popover" });
      expect(document.querySelector(".popover")?.classList.contains("custom-popover")).toBe(true);
    });

    it("position 为 fixed", () => {
      renderPopover();
      const popover = document.querySelector(".popover") as HTMLElement;
      expect(popover.style.position).toBe("fixed");
    });

    it("z-index 使用 CSS 变量", () => {
      renderPopover();
      const popover = document.querySelector(".popover") as HTMLElement;
      expect(popover.style.zIndex).toBe("var(--z-popover, 1000)");
    });

    it("位置计算完成后 visibility 为 visible", () => {
      renderPopover();
      const popover = document.querySelector(".popover") as HTMLElement;
      expect(popover.style.visibility).toBe("visible");
    });
  });

  describe("位置计算 - top placement", () => {
    it("top placement 时定位在 anchor 上方", () => {
      renderPopover({ placement: "top" });
      const popover = document.querySelector(".popover") as HTMLElement;
      // anchor.top (200) - popover.height (80) - gap (8) = 112
      expect(popover.style.top).toBe("112px");
    });

    it("top placement 时水平居中于 anchor", () => {
      renderPopover({ placement: "top" });
      const popover = document.querySelector(".popover") as HTMLElement;
      // anchor.left (100) + anchor.width/2 (100) - popover.width/2 (75) = 125
      expect(popover.style.left).toBe("125px");
    });

    it("自定义 gap 时正确计算位置", () => {
      renderPopover({ placement: "top", gap: 20 });
      const popover = document.querySelector(".popover") as HTMLElement;
      // anchor.top (200) - popover.height (80) - gap (20) = 100
      expect(popover.style.top).toBe("100px");
    });
  });

  describe("位置计算 - bottom placement", () => {
    it("bottom placement 时定位在 anchor 下方", () => {
      renderPopover({ placement: "bottom" });
      const popover = document.querySelector(".popover") as HTMLElement;
      // anchor.bottom (240) + gap (8) = 248
      expect(popover.style.top).toBe("248px");
    });

    it("bottom placement 时水平居中于 anchor", () => {
      renderPopover({ placement: "bottom" });
      const popover = document.querySelector(".popover") as HTMLElement;
      // anchor.left (100) + anchor.width/2 (100) - popover.width/2 (75) = 125
      expect(popover.style.left).toBe("125px");
    });
  });

  describe("自动翻转", () => {
    it("top placement 空间不足时翻转为 bottom", () => {
      // anchor.top = 50, popover.height = 80, gap = 8 => 需要 88px，只有 50px
      const anchor: Rect = { ...sampleAnchor, top: 50, bottom: 90 };
      renderPopover({ placement: "top", anchor });
      const popover = document.querySelector(".popover") as HTMLElement;
      // 翻转后：anchor.bottom (90) + gap (8) = 98
      expect(popover.style.top).toBe("98px");
    });

    it("bottom placement 空间不足时翻转为 top", () => {
      // viewport height = 768, anchor.bottom = 700, popover.height = 80, gap = 8
      // 需要 88px，只有 68px
      const anchor: Rect = { ...sampleAnchor, top: 660, bottom: 700 };
      renderPopover({ placement: "bottom", anchor });
      const popover = document.querySelector(".popover") as HTMLElement;
      // 翻转后：anchor.top (660) - popover.height (80) - gap (8) = 572
      expect(popover.style.top).toBe("572px");
    });

    it("top placement 空间充足时不翻转", () => {
      renderPopover({ placement: "top" });
      const popover = document.querySelector(".popover") as HTMLElement;
      // 不翻转：anchor.top (200) - popover.height (80) - gap (8) = 112
      expect(popover.style.top).toBe("112px");
    });
  });

  describe("视口限制", () => {
    it("水平位置超出左边界时限制在 margin 处", () => {
      const anchor: Rect = { ...sampleAnchor, left: 0, width: 50 };
      renderPopover({ placement: "top", anchor });
      const popover = document.querySelector(".popover") as HTMLElement;
      // 计算 left = 0 + 25 - 75 = -50，限制为 margin (12)
      expect(popover.style.left).toBe("12px");
    });

    it("水平位置超出右边界时限制在视口内", () => {
      const anchor: Rect = { ...sampleAnchor, left: 900, width: 100 };
      renderPopover({ placement: "top", anchor });
      const popover = document.querySelector(".popover") as HTMLElement;
      // 计算 left = 900 + 50 - 75 = 875
      // 右边界限制：vw (1024) - popover.width (150) - margin (12) = 862
      expect(popover.style.left).toBe("862px");
    });

    it("自定义 margin 时正确限制", () => {
      const anchor: Rect = { ...sampleAnchor, left: 0, width: 50 };
      renderPopover({ placement: "top", anchor, margin: 30 });
      const popover = document.querySelector(".popover") as HTMLElement;
      expect(popover.style.left).toBe("30px");
    });
  });

  describe("事件监听", () => {
    it("监听 scroll 事件", () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      renderPopover();
      expect(addSpy).toHaveBeenCalledWith("scroll", expect.any(Function), true);
    });

    it("监听 resize 事件", () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      renderPopover();
      expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    });

    it("组件卸载时移除事件监听", () => {
      const removeSpy = vi.spyOn(window, "removeEventListener");
      const { unmount } = renderPopover();
      unmount();
      expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function), true);
      expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    });

    it("scroll 事件触发重新计算位置", () => {
      renderPopover();
      const popover = document.querySelector(".popover") as HTMLElement;
      const initialTop = popover.style.top;
      // 改变 anchor 位置（通过重新渲染模拟）
      // 实际上 scroll 会触发 compute，但 anchor 没变，所以位置不变
      fireEvent.scroll(window);
      expect(popover.style.top).toBe(initialTop);
    });
  });

  describe("children", () => {
    it("渲染自定义 children", () => {
      renderPopover({ children: <span data-testid="custom-content">Custom</span> });
      expect(screen.getByTestId("custom-content")).toBeInTheDocument();
    });

    it("渲染复杂 children", () => {
      renderPopover({
        children: (
          <div>
            <h3>Title</h3>
            <p>Paragraph</p>
            <button>Action</button>
          </div>
        ),
      });
      expect(screen.getByText("Title")).toBeInTheDocument();
      expect(screen.getByText("Paragraph")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Action" })).toBeInTheDocument();
    });
  });
});
