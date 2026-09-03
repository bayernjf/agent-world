import { render, screen, fireEvent } from "@testing-library/react";
import NewGraphDialog from "./NewGraphDialog";

// Mock TemplatePicker
const mockTemplatePickerOnPick = vi.fn();
vi.mock("./TemplatePicker", () => ({
  default: ({ templates, blankFirst, onPick }: any) => {
    mockTemplatePickerOnPick.mockImplementation(onPick);
    return (
      <div data-testid="template-picker" data-blank-first={blankFirst ? "true" : "false"}>
        <button onClick={() => onPick(undefined)}>空白产线</button>
        <button onClick={() => onPick("tpl-simple")}>简单模板</button>
        <button onClick={() => onPick("tpl-with-fields")}>带参数模板</button>
      </div>
    );
  },
  TEMPLATE_LIST: [
    { id: "tpl-simple", name: "简单模板", fields: [] },
    { id: "tpl-with-fields", name: "带参数模板", fields: [{ key: "url", label: "链接", defaultValue: "" }] },
  ],
}));

// Mock TemplateFieldDialog
const mockFieldDialogOnSubmit = vi.fn();
const mockFieldDialogOnCancel = vi.fn();
vi.mock("./TemplateFieldDialog", () => ({
  default: ({ templateName, fields, onCancel, onSubmit }: any) => {
    mockFieldDialogOnCancel.mockImplementation(onCancel);
    mockFieldDialogOnSubmit.mockImplementation(onSubmit);
    return (
      <div data-testid="template-field-dialog" data-template-name={templateName}>
        <span>参数表单: {templateName}</span>
        <button onClick={() => onCancel()}>取消参数</button>
        <button onClick={() => onSubmit({ url: "https://example.com" })}>提交参数</button>
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

function renderComponent(overrides: Partial<{
  open: boolean;
  onClose: () => void;
  onPick: (templateId?: string, fieldValues?: Record<string, string>) => void;
}> = {}) {
  const onClose = vi.fn();
  const onPick = vi.fn();
  render(
    <NewGraphDialog
      open={overrides.open ?? true}
      onClose={overrides.onClose ?? onClose}
      onPick={overrides.onPick ?? onPick}
    />,
  );
  return { onClose: overrides.onClose ?? onClose, onPick: overrides.onPick ?? onPick };
}

describe("NewGraphDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(<NewGraphDialog open={false} onClose={vi.fn()} onPick={vi.fn()} />);
      expect(container.firstChild).toBeNull();
    });

    it("显示'新建产线'标题", () => {
      renderComponent();
      expect(screen.getByText("新建产线")).toBeInTheDocument();
    });

    it("显示提示文字", () => {
      renderComponent();
      expect(screen.getByText("从空白产线开始搭建，或选择一个模板。")).toBeInTheDocument();
    });

    it("渲染 TemplatePicker", () => {
      renderComponent();
      expect(screen.getByTestId("template-picker")).toBeInTheDocument();
    });

    it("TemplatePicker 设置 blankFirst", () => {
      renderComponent();
      expect(screen.getByTestId("template-picker")).toHaveAttribute("data-blank-first", "true");
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

    it("modal 宽度为 640", () => {
      renderComponent();
      const modal = document.querySelector(".modal") as HTMLElement;
      expect(modal.style.width).toBe("640px");
    });
  });

  describe("模板选择", () => {
    it("选择空白产线调用 onPick(undefined)", () => {
      const { onPick } = renderComponent();
      fireEvent.click(screen.getByText("空白产线"));
      expect(onPick).toHaveBeenCalledWith(undefined);
    });

    it("选择无 fields 的模板直接调用 onPick(id)", () => {
      const { onPick } = renderComponent();
      fireEvent.click(screen.getByText("简单模板"));
      expect(onPick).toHaveBeenCalledWith("tpl-simple");
    });

    it("选择有 fields 的模板显示参数表单", () => {
      renderComponent();
      fireEvent.click(screen.getByText("带参数模板"));
      expect(screen.getByTestId("template-field-dialog")).toBeInTheDocument();
      expect(screen.getByText("参数表单: 带参数模板")).toBeInTheDocument();
    });

    it("选择有 fields 的模板不直接调用 onPick", () => {
      const { onPick } = renderComponent();
      fireEvent.click(screen.getByText("带参数模板"));
      expect(onPick).not.toHaveBeenCalled();
    });
  });

  describe("参数表单", () => {
    it("参数表单取消后关闭表单", () => {
      renderComponent();
      fireEvent.click(screen.getByText("带参数模板"));
      expect(screen.getByTestId("template-field-dialog")).toBeInTheDocument();
      fireEvent.click(screen.getByText("取消参数"));
      expect(screen.queryByTestId("template-field-dialog")).not.toBeInTheDocument();
    });

    it("参数表单提交后调用 onPick(id, values)", () => {
      const { onPick } = renderComponent();
      fireEvent.click(screen.getByText("带参数模板"));
      fireEvent.click(screen.getByText("提交参数"));
      expect(onPick).toHaveBeenCalledWith("tpl-with-fields", { url: "https://example.com" });
    });

    it("参数表单提交后关闭表单", () => {
      renderComponent();
      fireEvent.click(screen.getByText("带参数模板"));
      fireEvent.click(screen.getByText("提交参数"));
      expect(screen.queryByTestId("template-field-dialog")).not.toBeInTheDocument();
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
      render(<NewGraphDialog open={false} onClose={onClose} onPick={vi.fn()} />);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("状态重置", () => {
    it("关闭后重新打开时 pending 状态重置", () => {
      const { rerender } = render(
        <NewGraphDialog open={true} onClose={vi.fn()} onPick={vi.fn()} />,
      );
      // 选择带参数模板
      fireEvent.click(screen.getByText("带参数模板"));
      expect(screen.getByTestId("template-field-dialog")).toBeInTheDocument();
      // 关闭
      rerender(<NewGraphDialog open={false} onClose={vi.fn()} onPick={vi.fn()} />);
      // 重新打开
      rerender(<NewGraphDialog open={true} onClose={vi.fn()} onPick={vi.fn()} />);
      expect(screen.queryByTestId("template-field-dialog")).not.toBeInTheDocument();
    });
  });
});
