import { render, screen, fireEvent, within } from "@testing-library/react";
import GlossaryModal from "./GlossaryModal";

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

function renderModal(open = true) {
  const onClose = vi.fn();
  render(<GlossaryModal open={open} onClose={onClose} />);
  return { onClose };
}

describe("GlossaryModal", () => {
  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(<GlossaryModal open={false} onClose={vi.fn()} />);
      expect(container.firstChild).toBeNull();
    });

    it("open=true 时显示标题'术语对照表'", () => {
      renderModal();
      expect(screen.getByText("术语对照表")).toBeInTheDocument();
    });

    it("显示关闭按钮", () => {
      renderModal();
      expect(screen.getByRole("button", { name: "✕" })).toBeInTheDocument();
    });

    it("显示介绍文字", () => {
      renderModal();
      expect(screen.getByText(/左侧为标准术语/)).toBeInTheDocument();
    });

    it("显示底部文字", () => {
      renderModal();
      expect(screen.getByText(/完整版见/)).toBeInTheDocument();
    });
  });

  describe("术语分组", () => {
    it("显示所有分组标题", () => {
      renderModal();
      expect(screen.getByText("核心实体")).toBeInTheDocument();
      expect(screen.getByText("节点类型明细")).toBeInTheDocument();
    });

    it("默认展开'核心实体'分组", () => {
      renderModal();
      const coreGroup = screen.getByText("核心实体").closest("details");
      expect(coreGroup).toHaveAttribute("open");
    });

    it("其他分组默认折叠", () => {
      renderModal();
      const nodeGroup = screen.getByText("节点类型明细").closest("details");
      expect(nodeGroup).not.toHaveAttribute("open");
    });

    it("点击分组标题可以展开/折叠", () => {
      renderModal();
      const summary = screen.getByText("节点类型明细");
      fireEvent.click(summary);
      const nodeGroup = summary.closest("details");
      expect(nodeGroup).toHaveAttribute("open");
    });
  });

  describe("术语表格", () => {
    it("显示表格表头（标准术语/Agent World/说明）", () => {
      renderModal();
      // 每个分组的表格都有表头，用 getAllByText
      expect(screen.getAllByText("标准术语").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Agent World").length).toBeGreaterThan(0);
      expect(screen.getAllByText("说明").length).toBeGreaterThan(0);
    });

    it("显示核心实体的术语行", () => {
      renderModal();
      // Graph / Flow → 产线
      expect(screen.getByText("产线")).toBeInTheDocument();
      // Node → 文坊 / 站 / 工位
      expect(screen.getByText(/文坊 \/ 站 \/ 工位/)).toBeInTheDocument();
      // Edge → 管道
      expect(screen.getByText("管道")).toBeInTheDocument();
    });

    it("显示术语说明", () => {
      renderModal();
      expect(screen.getByText("一张工作流图")).toBeInTheDocument();
      expect(screen.getByText("节点间的连接")).toBeInTheDocument();
    });

    it("节点类型分组包含特有节点类型术语", () => {
      renderModal();
      // 特有节点类型术语（核心实体分组中没有）
      // imageGen → 画坊
      expect(screen.getByText("画坊")).toBeInTheDocument();
      // videoGen → 影坊
      expect(screen.getByText("影坊")).toBeInTheDocument();
      // audioGen → 音坊
      expect(screen.getByText("音坊")).toBeInTheDocument();
      // code → 代码工坊
      expect(screen.getByText("代码工坊")).toBeInTheDocument();
      // http → API 口岸
      expect(screen.getByText("API 口岸")).toBeInTheDocument();
      // search → 瞭望塔
      expect(screen.getByText("瞭望塔")).toBeInTheDocument();
    });
  });

  describe("关闭", () => {
    it("点击关闭按钮调用 onClose", () => {
      const { onClose } = renderModal();
      fireEvent.click(screen.getByRole("button", { name: "✕" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击背景调用 onClose", () => {
      const { onClose } = renderModal();
      const backdrop = document.querySelector(".modal-backdrop")!;
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击模态框内容不调用 onClose", () => {
      const { onClose } = renderModal();
      const modal = document.querySelector(".modal")!;
      fireEvent.click(modal);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("按 Escape 键调用 onClose", () => {
      const { onClose } = renderModal();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
