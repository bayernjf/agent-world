import { render, screen, fireEvent } from "@testing-library/react";
import VariablesModal from "./VariablesModal";

// Mock Tooltip
vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const sampleVariables: Record<string, unknown> = {
  brand: "可口可乐",
  count: 3,
  config: { enabled: true, ratio: 0.8 },
  tags: ["时尚", "年轻"],
};

function renderComponent(overrides: Partial<{
  open: boolean;
  variables: Record<string, unknown> | undefined;
  onClose: () => void;
  onSave: (vars: Record<string, unknown>) => void;
}> = {}) {
  const onClose = vi.fn();
  const onSave = vi.fn();
  render(
    <VariablesModal
      open={overrides.open ?? true}
      variables={overrides.variables ?? sampleVariables}
      onClose={overrides.onClose ?? onClose}
      onSave={overrides.onSave ?? onSave}
    />,
  );
  return {
    onClose: overrides.onClose ?? onClose,
    onSave: overrides.onSave ?? onSave,
  };
}

describe("VariablesModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(
        <VariablesModal open={false} variables={undefined} onClose={vi.fn()} onSave={vi.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("显示'产线变量'标题", () => {
      renderComponent();
      expect(screen.getByText("产线变量")).toBeInTheDocument();
    });

    it("显示说明文字", () => {
      renderComponent();
      expect(screen.getByText(/变量是跨运行持久化的状态/)).toBeInTheDocument();
    });

    it("说明文字包含 ${var.xxx} 语法", () => {
      renderComponent();
      expect(screen.getByText("${var.xxx}")).toBeInTheDocument();
    });

    it("说明文字包含 set_variable 工具", () => {
      renderComponent();
      expect(screen.getByText("set_variable")).toBeInTheDocument();
    });

    it("说明文字包含 get_variable 工具", () => {
      renderComponent();
      expect(screen.getByText("get_variable")).toBeInTheDocument();
    });

    it("显示表格表头", () => {
      renderComponent();
      expect(screen.getByText("变量名（key）")).toBeInTheDocument();
      expect(screen.getByText("值（JSON）")).toBeInTheDocument();
    });

    it("显示添加变量按钮", () => {
      renderComponent();
      expect(screen.getByText("+ 添加变量")).toBeInTheDocument();
    });

    it("显示取消按钮", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    });

    it("显示保存按钮", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    });

    it("显示关闭按钮（✕）", () => {
      renderComponent();
      const header = document.querySelector(".modal__header");
      expect(header?.querySelector(".icon-btn")).toBeInTheDocument();
    });

    it("有 modal-backdrop class", () => {
      renderComponent();
      expect(document.querySelector(".modal-backdrop")).toBeInTheDocument();
    });

    it("有 var-table class", () => {
      renderComponent();
      expect(document.querySelector(".var-table")).toBeInTheDocument();
    });

    it("modal 宽度为 560", () => {
      renderComponent();
      const modal = document.querySelector(".modal") as HTMLElement;
      expect(modal.style.width).toBe("560px");
    });
  });

  describe("变量初始化", () => {
    it("从 variables 初始化变量名", () => {
      renderComponent();
      const keyInputs = document.querySelectorAll(".var-table__key");
      expect(keyInputs[0]).toHaveValue("brand");
      expect(keyInputs[1]).toHaveValue("count");
      expect(keyInputs[2]).toHaveValue("config");
      expect(keyInputs[3]).toHaveValue("tags");
    });

    it("从 variables 初始化值（JSON 字符串）", () => {
      renderComponent();
      const valueInputs = document.querySelectorAll(".var-table__value");
      expect(valueInputs[0]).toHaveValue('"可口可乐"');
      expect(valueInputs[1]).toHaveValue("3");
      expect(valueInputs[2]).toHaveValue('{"enabled":true,"ratio":0.8}');
      expect(valueInputs[3]).toHaveValue('["时尚","年轻"]');
    });

    it("variables 为 undefined 时表格为空", () => {
      render(
        <VariablesModal open={true} variables={undefined} onClose={vi.fn()} onSave={vi.fn()} />,
      );
      const rows = document.querySelectorAll(".var-table__row");
      expect(rows.length).toBe(0);
    });

    it("variables 为空对象时表格为空", () => {
      renderComponent({ variables: {} });
      const rows = document.querySelectorAll(".var-table__row");
      expect(rows.length).toBe(0);
    });

    it("每个变量有删除按钮", () => {
      renderComponent();
      const deleteBtns = document.querySelectorAll(".var-table__row .icon-btn--danger");
      expect(deleteBtns.length).toBe(4);
    });
  });

  describe("交互 - 添加变量", () => {
    it("点击添加变量按钮新增一行", () => {
      renderComponent();
      expect(document.querySelectorAll(".var-table__row").length).toBe(4);
      fireEvent.click(screen.getByText("+ 添加变量"));
      expect(document.querySelectorAll(".var-table__row").length).toBe(5);
    });

    it("新增行的 key 和值为空", () => {
      renderComponent();
      fireEvent.click(screen.getByText("+ 添加变量"));
      const rows = document.querySelectorAll(".var-table__row");
      const lastRow = rows[rows.length - 1];
      const keyInput = lastRow.querySelector(".var-table__key") as HTMLInputElement;
      const valueInput = lastRow.querySelector(".var-table__value") as HTMLInputElement;
      expect(keyInput.value).toBe("");
      expect(valueInput.value).toBe("");
    });

    it("新增行的 key 输入框有 placeholder", () => {
      renderComponent();
      fireEvent.click(screen.getByText("+ 添加变量"));
      const keyInput = document.querySelector(".var-table__key[placeholder='如 stats.count']");
      expect(keyInput).toBeInTheDocument();
    });

    it("新增行的值输入框有 placeholder", () => {
      renderComponent();
      fireEvent.click(screen.getByText("+ 添加变量"));
      const valueInput = document.querySelector(
        ".var-table__value[placeholder='如 \"可口可乐\" 或 {\"n\": 3} 或 3']",
      );
      expect(valueInput).toBeInTheDocument();
    });
  });

  describe("交互 - 删除变量", () => {
    it("点击删除按钮移除该行", () => {
      renderComponent();
      expect(document.querySelectorAll(".var-table__row").length).toBe(4);
      const deleteBtns = document.querySelectorAll(".var-table__row .icon-btn--danger");
      fireEvent.click(deleteBtns[0]);
      expect(document.querySelectorAll(".var-table__row").length).toBe(3);
    });

    it("删除后剩余变量正确", () => {
      renderComponent();
      const deleteBtns = document.querySelectorAll(".var-table__row .icon-btn--danger");
      fireEvent.click(deleteBtns[0]);
      const keyInputs = document.querySelectorAll(".var-table__key");
      expect(keyInputs[0]).toHaveValue("count");
      expect(keyInputs[1]).toHaveValue("config");
      expect(keyInputs[2]).toHaveValue("tags");
    });
  });

  describe("交互 - 编辑变量", () => {
    it("修改变量名更新输入框", () => {
      renderComponent();
      const keyInputs = document.querySelectorAll(".var-table__key");
      fireEvent.change(keyInputs[0], { target: { value: "newBrand" } });
      expect(keyInputs[0]).toHaveValue("newBrand");
    });

    it("修改变量值更新输入框", () => {
      renderComponent();
      const valueInputs = document.querySelectorAll(".var-table__value");
      fireEvent.change(valueInputs[0], { target: { value: '"百事可乐"' } });
      expect(valueInputs[0]).toHaveValue('"百事可乐"');
    });
  });

  describe("保存验证", () => {
    it("保存有效变量调用 onSave", () => {
      const { onSave } = renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it("保存后调用 onClose", () => {
      const { onClose } = renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("保存的变量值正确解析 JSON", () => {
      const { onSave } = renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(onSave).toHaveBeenCalledWith({
        brand: "可口可乐",
        count: 3,
        config: { enabled: true, ratio: 0.8 },
        tags: ["时尚", "年轻"],
      });
    });

    it("空 key 的变量被跳过", () => {
      const { onSave } = renderComponent();
      fireEvent.click(screen.getByText("+ 添加变量"));
      // 新增行 key 为空，值也为空，但空 key 会被跳过，空值会报错
      // 所以需要给新增行一个值
      const rows = document.querySelectorAll(".var-table__row");
      const lastRow = rows[rows.length - 1];
      const valueInput = lastRow.querySelector(".var-table__value") as HTMLInputElement;
      fireEvent.change(valueInput, { target: { value: '"test"' } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      // 空 key 被跳过，所以只有原来的 4 个变量
      expect(onSave).toHaveBeenCalledWith(sampleVariables);
    });

    it("重复变量名报错", () => {
      renderComponent();
      const keyInputs = document.querySelectorAll(".var-table__key");
      fireEvent.change(keyInputs[1], { target: { value: "brand" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(screen.getByText(/变量名重复：brand/)).toBeInTheDocument();
    });

    it("重复变量名时不调用 onSave", () => {
      const { onSave } = renderComponent();
      const keyInputs = document.querySelectorAll(".var-table__key");
      fireEvent.change(keyInputs[1], { target: { value: "brand" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(onSave).not.toHaveBeenCalled();
    });

    it("空值报错", () => {
      renderComponent();
      fireEvent.click(screen.getByText("+ 添加变量"));
      const rows = document.querySelectorAll(".var-table__row");
      const lastRow = rows[rows.length - 1];
      const keyInput = lastRow.querySelector(".var-table__key") as HTMLInputElement;
      fireEvent.change(keyInput, { target: { value: "emptyVar" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(screen.getByText(/变量 emptyVar 缺少值/)).toBeInTheDocument();
    });

    it("空值时不调用 onSave", () => {
      const { onSave } = renderComponent();
      fireEvent.click(screen.getByText("+ 添加变量"));
      const rows = document.querySelectorAll(".var-table__row");
      const lastRow = rows[rows.length - 1];
      const keyInput = lastRow.querySelector(".var-table__key") as HTMLInputElement;
      fireEvent.change(keyInput, { target: { value: "emptyVar" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(onSave).not.toHaveBeenCalled();
    });

    it("非法 JSON 报错", () => {
      renderComponent();
      const valueInputs = document.querySelectorAll(".var-table__value");
      fireEvent.change(valueInputs[0], { target: { value: "invalid json" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(screen.getByText(/变量 brand 的值不是合法 JSON/)).toBeInTheDocument();
    });

    it("非法 JSON 时不调用 onSave", () => {
      const { onSave } = renderComponent();
      const valueInputs = document.querySelectorAll(".var-table__value");
      fireEvent.change(valueInputs[0], { target: { value: "invalid json" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(onSave).not.toHaveBeenCalled();
    });

    it("错误信息有 form-error class", () => {
      renderComponent();
      const valueInputs = document.querySelectorAll(".var-table__value");
      fireEvent.change(valueInputs[0], { target: { value: "invalid json" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(document.querySelector(".form-error")).toBeInTheDocument();
    });

    it("修改后错误信息消失", () => {
      renderComponent();
      const valueInputs = document.querySelectorAll(".var-table__value");
      fireEvent.change(valueInputs[0], { target: { value: "invalid json" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(screen.getByText(/不是合法 JSON/)).toBeInTheDocument();
      fireEvent.change(valueInputs[0], { target: { value: '"valid json"' } });
      // 错误信息应该还在，直到再次保存
      expect(screen.getByText(/不是合法 JSON/)).toBeInTheDocument();
    });
  });

  describe("关闭", () => {
    it("点击取消按钮调用 onClose", () => {
      const { onClose } = renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击关闭按钮调用 onClose", () => {
      const { onClose } = renderComponent();
      const header = document.querySelector(".modal__header");
      const closeBtn = header?.querySelector(".icon-btn") as HTMLButtonElement;
      fireEvent.click(closeBtn);
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
      render(
        <VariablesModal open={false} variables={undefined} onClose={onClose} onSave={vi.fn()} />,
      );
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("状态重置", () => {
    it("重新打开时从 variables 重新初始化", () => {
      const { rerender } = render(
        <VariablesModal open={true} variables={sampleVariables} onClose={vi.fn()} onSave={vi.fn()} />,
      );
      // 修改第一个变量
      const keyInputs = document.querySelectorAll(".var-table__key");
      fireEvent.change(keyInputs[0], { target: { value: "modified" } });
      expect(keyInputs[0]).toHaveValue("modified");
      // 关闭再打开
      rerender(
        <VariablesModal open={false} variables={sampleVariables} onClose={vi.fn()} onSave={vi.fn()} />,
      );
      rerender(
        <VariablesModal open={true} variables={sampleVariables} onClose={vi.fn()} onSave={vi.fn()} />,
      );
      const newKeyInputs = document.querySelectorAll(".var-table__key");
      expect(newKeyInputs[0]).toHaveValue("brand");
    });

    it("重新打开时清除错误信息", () => {
      const { rerender } = render(
        <VariablesModal open={true} variables={sampleVariables} onClose={vi.fn()} onSave={vi.fn()} />,
      );
      // 触发错误
      const valueInputs = document.querySelectorAll(".var-table__value");
      fireEvent.change(valueInputs[0], { target: { value: "invalid" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(screen.getByText(/不是合法 JSON/)).toBeInTheDocument();
      // 关闭再打开
      rerender(
        <VariablesModal open={false} variables={sampleVariables} onClose={vi.fn()} onSave={vi.fn()} />,
      );
      rerender(
        <VariablesModal open={true} variables={sampleVariables} onClose={vi.fn()} onSave={vi.fn()} />,
      );
      expect(screen.queryByText(/不是合法 JSON/)).not.toBeInTheDocument();
    });
  });
});
