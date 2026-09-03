import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BrandTermsModal from "./BrandTermsModal";
import type { BrandTerm } from "../lib/api";

// Mock api
const mockListBrandTerms = vi.fn();
const mockAddBrandTerm = vi.fn();
const mockDeleteBrandTerm = vi.fn();
vi.mock("../lib/api", () => ({
  api: {
    listBrandTerms: () => mockListBrandTerms(),
    addBrandTerm: (term: string, note: string) => mockAddBrandTerm(term, note),
    deleteBrandTerm: (id: string) => mockDeleteBrandTerm(id),
  },
}));

// Mock Tooltip
vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const sampleTerms: BrandTerm[] = [
  { id: "term-1", term: "显瘦", note: "服装类常用" },
  { id: "term-2", term: "高端", note: "" },
  { id: "term-3", term: "性价比", note: "数码类常用" },
];

function renderComponent(overrides: Partial<{
  open: boolean;
  onClose: () => void;
}> = {}) {
  const onClose = vi.fn();
  render(
    <BrandTermsModal
      open={overrides.open ?? true}
      onClose={overrides.onClose ?? onClose}
    />,
  );
  return { onClose: overrides.onClose ?? onClose };
}

describe("BrandTermsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListBrandTerms.mockResolvedValue(sampleTerms);
    mockAddBrandTerm.mockResolvedValue(undefined);
    mockDeleteBrandTerm.mockResolvedValue(undefined);
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(<BrandTermsModal open={false} onClose={vi.fn()} />);
      expect(container.firstChild).toBeNull();
    });

    it("显示'品牌词库'标题", () => {
      renderComponent();
      expect(screen.getByText("品牌词库")).toBeInTheDocument();
    });

    it("显示说明文字", () => {
      renderComponent();
      expect(screen.getByText(/维护建议融入的品牌词/)).toBeInTheDocument();
    });

    it("显示关闭按钮（✕）", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "✕" })).toBeInTheDocument();
    });

    it("有 modal-backdrop class", () => {
      renderComponent();
      expect(document.querySelector(".modal-backdrop")).toBeInTheDocument();
    });

    it("有 modal class", () => {
      renderComponent();
      expect(document.querySelector(".modal")).toBeInTheDocument();
    });

    it("有 brand-list class", () => {
      renderComponent();
      expect(document.querySelector(".brand-list")).toBeInTheDocument();
    });

    it("有 brand-add class", () => {
      renderComponent();
      expect(document.querySelector(".brand-add")).toBeInTheDocument();
    });
  });

  describe("品牌词列表", () => {
    it("渲染所有品牌词", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getByText("显瘦")).toBeInTheDocument();
        expect(screen.getByText("高端")).toBeInTheDocument();
        expect(screen.getByText("性价比")).toBeInTheDocument();
      });
    });

    it("显示有备注的品牌词备注", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getByText(/服装类常用/)).toBeInTheDocument();
        expect(screen.getByText(/数码类常用/)).toBeInTheDocument();
      });
    });

    it("无备注的品牌词不显示备注分隔符", async () => {
      renderComponent();
      await waitFor(() => {
        const highEnd = screen.getByText("高端");
        expect(highEnd.closest("li")?.textContent).not.toContain("—");
      });
    });

    it("每个品牌词有删除按钮", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getAllByText("删除")).toHaveLength(3);
      });
    });

    it("品牌词有 brand-term class", async () => {
      renderComponent();
      await waitFor(() => {
        expect(document.querySelectorAll(".brand-term").length).toBe(3);
      });
    });
  });

  describe("空状态", () => {
    it("品牌词为空时显示空状态提示", async () => {
      mockListBrandTerms.mockResolvedValue([]);
      renderComponent();
      await waitFor(() => {
        expect(screen.getByText("暂无品牌词，先在下方添加。")).toBeInTheDocument();
      });
    });

    it("空状态时不显示删除按钮", async () => {
      mockListBrandTerms.mockResolvedValue([]);
      renderComponent();
      await waitFor(() => {
        expect(screen.queryByText("删除")).not.toBeInTheDocument();
      });
    });
  });

  describe("添加品牌词", () => {
    it("显示品牌词输入框", () => {
      renderComponent();
      expect(screen.getByPlaceholderText("品牌词，如 显瘦")).toBeInTheDocument();
    });

    it("显示备注输入框", () => {
      renderComponent();
      expect(screen.getByPlaceholderText("备注（可选）")).toBeInTheDocument();
    });

    it("显示添加按钮", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "添加" })).toBeInTheDocument();
    });

    it("品牌词为空时添加按钮禁用", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "添加" })).toBeDisabled();
    });

    it("品牌词只有空格时添加按钮禁用", () => {
      renderComponent();
      fireEvent.change(screen.getByPlaceholderText("品牌词，如 显瘦"), {
        target: { value: "   " },
      });
      expect(screen.getByRole("button", { name: "添加" })).toBeDisabled();
    });

    it("品牌词非空时添加按钮启用", () => {
      renderComponent();
      fireEvent.change(screen.getByPlaceholderText("品牌词，如 显瘦"), {
        target: { value: "新品牌词" },
      });
      expect(screen.getByRole("button", { name: "添加" })).not.toBeDisabled();
    });

    it("点击添加按钮调用 api.addBrandTerm", async () => {
      renderComponent();
      fireEvent.change(screen.getByPlaceholderText("品牌词，如 显瘦"), {
        target: { value: "新品牌词" },
      });
      fireEvent.change(screen.getByPlaceholderText("备注（可选）"), {
        target: { value: "新备注" },
      });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => {
        expect(mockAddBrandTerm).toHaveBeenCalledWith("新品牌词", "新备注");
      });
    });

    it("添加成功后清空输入框", async () => {
      renderComponent();
      fireEvent.change(screen.getByPlaceholderText("品牌词，如 显瘦"), {
        target: { value: "新品牌词" },
      });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => {
        expect(screen.getByPlaceholderText("品牌词，如 显瘦")).toHaveValue("");
        expect(screen.getByPlaceholderText("备注（可选）")).toHaveValue("");
      });
    });

    it("添加成功后重新加载列表", async () => {
      renderComponent();
      fireEvent.change(screen.getByPlaceholderText("品牌词，如 显瘦"), {
        target: { value: "新品牌词" },
      });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => {
        expect(mockListBrandTerms).toHaveBeenCalledTimes(2);
      });
    });

    it("按 Enter 键添加品牌词", async () => {
      renderComponent();
      fireEvent.change(screen.getByPlaceholderText("品牌词，如 显瘦"), {
        target: { value: "回车品牌词" },
      });
      fireEvent.keyDown(screen.getByPlaceholderText("品牌词，如 显瘦"), {
        key: "Enter",
      });
      await waitFor(() => {
        expect(mockAddBrandTerm).toHaveBeenCalledWith("回车品牌词", "");
      });
    });

    it("添加失败时显示错误信息", async () => {
      mockAddBrandTerm.mockRejectedValue(new Error("品牌词已存在"));
      renderComponent();
      fireEvent.change(screen.getByPlaceholderText("品牌词，如 显瘦"), {
        target: { value: "重复品牌词" },
      });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => {
        expect(screen.getByText("品牌词已存在")).toBeInTheDocument();
      });
    });

    it("添加失败时错误信息有 error-text class", async () => {
      mockAddBrandTerm.mockRejectedValue(new Error("添加失败"));
      renderComponent();
      fireEvent.change(screen.getByPlaceholderText("品牌词，如 显瘦"), {
        target: { value: "失败品牌词" },
      });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => {
        expect(document.querySelector(".error-text")).toBeInTheDocument();
      });
    });

    it("添加失败时不清空输入框", async () => {
      mockAddBrandTerm.mockRejectedValue(new Error("添加失败"));
      renderComponent();
      fireEvent.change(screen.getByPlaceholderText("品牌词，如 显瘦"), {
        target: { value: "失败品牌词" },
      });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => {
        expect(screen.getByPlaceholderText("品牌词，如 显瘦")).toHaveValue("失败品牌词");
      });
    });
  });

  describe("删除品牌词", () => {
    it("点击删除按钮调用 api.deleteBrandTerm", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getAllByText("删除")).toHaveLength(3);
      });
      fireEvent.click(screen.getAllByText("删除")[0]);
      await waitFor(() => {
        expect(mockDeleteBrandTerm).toHaveBeenCalledWith("term-1");
      });
    });

    it("删除成功后重新加载列表", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getAllByText("删除")).toHaveLength(3);
      });
      fireEvent.click(screen.getAllByText("删除")[0]);
      await waitFor(() => {
        expect(mockListBrandTerms).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("关闭", () => {
    it("点击关闭按钮调用 onClose", () => {
      const { onClose } = renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "✕" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击背景调用 onClose", () => {
      const { onClose } = renderComponent();
      const backdrop = document.querySelector(".modal-backdrop")!;
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击模态框内容不调用 onClose", () => {
      const { onClose } = renderComponent();
      const modal = document.querySelector(".modal")!;
      fireEvent.click(modal);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("按 Escape 键调用 onClose", () => {
      const { onClose } = renderComponent();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("open=false 时不监听 Escape 键", () => {
      const onClose = vi.fn();
      render(<BrandTermsModal open={false} onClose={onClose} />);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("API 调用", () => {
    it("组件打开时调用 api.listBrandTerms", async () => {
      renderComponent();
      await waitFor(() => {
        expect(mockListBrandTerms).toHaveBeenCalledTimes(1);
      });
    });

    it("API 调用失败时不崩溃", async () => {
      mockListBrandTerms.mockRejectedValue(new Error("Network error"));
      renderComponent();
      await waitFor(() => {
        expect(screen.getByText("品牌词库")).toBeInTheDocument();
      });
    });
  });
});
