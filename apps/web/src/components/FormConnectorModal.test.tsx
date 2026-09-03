import { render, screen, fireEvent } from "@testing-library/react";
import FormConnectorModal from "./FormConnectorModal";
import type { FormConnector } from "@agent-world/core";

type FormField = FormConnector["fields"][number];

// Mock Tooltip
vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const sampleFields: FormField[] = [
  { name: "url", label: "目标链接", required: true },
  { name: "keyword", label: "关键词", required: false },
  { name: "count", label: "数量", required: true },
];

function renderComponent(overrides: Partial<{
  fields: FormField[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <FormConnectorModal
      fields={overrides.fields ?? sampleFields}
      onSubmit={overrides.onSubmit ?? onSubmit}
      onCancel={overrides.onCancel ?? onCancel}
    />,
  );
  return { onSubmit: overrides.onSubmit ?? onSubmit, onCancel: overrides.onCancel ?? onCancel };
}

describe("FormConnectorModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("渲染", () => {
    it("显示'填写数据源表单'标题", () => {
      renderComponent();
      expect(screen.getByText("填写数据源表单")).toBeInTheDocument();
    });

    it("显示提示文字", () => {
      renderComponent();
      expect(
        screen.getByText("以下字段将作为数据源（Connector）注入 source 节点，再跑整条产线。"),
      ).toBeInTheDocument();
    });

    it("显示所有字段标签", () => {
      renderComponent();
      expect(screen.getByText("目标链接 *")).toBeInTheDocument();
      expect(screen.getByText("关键词")).toBeInTheDocument();
      expect(screen.getByText("数量 *")).toBeInTheDocument();
    });

    it("必填字段显示 *", () => {
      renderComponent();
      expect(screen.getByText("目标链接 *")).toBeInTheDocument();
      expect(screen.getByText("数量 *")).toBeInTheDocument();
    });

    it("非必填字段不显示 *", () => {
      renderComponent();
      expect(screen.getByText("关键词")).toBeInTheDocument();
      expect(screen.queryByText("关键词 *")).not.toBeInTheDocument();
    });

    it("渲染所有字段输入框", () => {
      renderComponent();
      const inputs = screen.getAllByRole("textbox");
      expect(inputs).toHaveLength(3);
    });

    it("输入框初始为空", () => {
      renderComponent();
      const inputs = screen.getAllByRole("textbox");
      inputs.forEach((input) => {
        expect(input).toHaveValue("");
      });
    });

    it("显示取消按钮", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    });

    it("显示开始运行按钮", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "开始运行" })).toBeInTheDocument();
    });

    it("显示关闭按钮（×）", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "×" })).toBeInTheDocument();
    });

    it("有 modal-backdrop class", () => {
      renderComponent();
      expect(document.querySelector(".modal-backdrop")).toBeInTheDocument();
    });

    it("有 modal class", () => {
      renderComponent();
      expect(document.querySelector(".modal")).toBeInTheDocument();
    });
  });

  describe("交互", () => {
    it("修改输入框更新值", () => {
      renderComponent();
      const inputs = screen.getAllByRole("textbox");
      fireEvent.change(inputs[0], { target: { value: "https://example.com" } });
      expect(inputs[0]).toHaveValue("https://example.com");
    });

    it("点击取消按钮调用 onCancel", () => {
      const { onCancel } = renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("点击关闭按钮调用 onCancel", () => {
      const { onCancel } = renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "×" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("点击背景调用 onCancel", () => {
      const { onCancel } = renderComponent();
      const backdrop = document.querySelector(".modal-backdrop")!;
      fireEvent.click(backdrop);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("点击模态框内容不调用 onCancel", () => {
      const { onCancel } = renderComponent();
      const modal = document.querySelector(".modal")!;
      fireEvent.click(modal);
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe("必填验证", () => {
    it("必填项为空时显示错误信息", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "开始运行" }));
      expect(screen.getByText(/请填写必填项/)).toBeInTheDocument();
    });

    it("错误信息包含缺失的必填字段名", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "开始运行" }));
      const errorText = document.querySelector(".error-text")?.textContent;
      expect(errorText).toContain("目标链接");
      expect(errorText).toContain("数量");
    });

    it("必填项为空时不调用 onSubmit", () => {
      const { onSubmit } = renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "开始运行" }));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("必填项只填空格时显示错误", () => {
      renderComponent();
      const inputs = screen.getAllByRole("textbox");
      fireEvent.change(inputs[0], { target: { value: "   " } });
      fireEvent.change(inputs[2], { target: { value: "   " } });
      fireEvent.click(screen.getByRole("button", { name: "开始运行" }));
      expect(screen.getByText(/请填写必填项/)).toBeInTheDocument();
    });

    it("填写必填项后不显示错误", () => {
      renderComponent();
      const inputs = screen.getAllByRole("textbox");
      fireEvent.change(inputs[0], { target: { value: "https://example.com" } });
      fireEvent.change(inputs[2], { target: { value: "10" } });
      fireEvent.click(screen.getByRole("button", { name: "开始运行" }));
      expect(screen.queryByText(/请填写必填项/)).not.toBeInTheDocument();
    });

    it("填写必填项后调用 onSubmit", () => {
      const { onSubmit } = renderComponent();
      const inputs = screen.getAllByRole("textbox");
      fireEvent.change(inputs[0], { target: { value: "https://example.com" } });
      fireEvent.change(inputs[1], { target: { value: "测试关键词" } });
      fireEvent.change(inputs[2], { target: { value: "10" } });
      fireEvent.click(screen.getByRole("button", { name: "开始运行" }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({
        url: "https://example.com",
        keyword: "测试关键词",
        count: "10",
      });
    });

    it("错误信息有 error-text class", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "开始运行" }));
      expect(document.querySelector(".error-text")).toBeInTheDocument();
    });

    it("修改输入后错误信息消失", () => {
      renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "开始运行" }));
      expect(screen.getByText(/请填写必填项/)).toBeInTheDocument();
      const inputs = screen.getAllByRole("textbox");
      fireEvent.change(inputs[0], { target: { value: "https://example.com" } });
      // 错误信息应该还在（因为还有其他必填项为空）
      expect(screen.getByText(/请填写必填项/)).toBeInTheDocument();
    });
  });

  describe("空字段", () => {
    it("fields 为空时只显示标题和按钮", () => {
      renderComponent({ fields: [] });
      expect(screen.getByText("填写数据源表单")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "开始运行" })).toBeInTheDocument();
    });

    it("fields 为空时点击开始运行调用 onSubmit", () => {
      const { onSubmit } = renderComponent({ fields: [] });
      fireEvent.click(screen.getByRole("button", { name: "开始运行" }));
      expect(onSubmit).toHaveBeenCalledWith({});
    });
  });

  describe("字段无 label", () => {
    it("字段无 label 时显示 name", () => {
      const fields: FormField[] = [{ name: "raw_field", required: false }];
      renderComponent({ fields });
      expect(screen.getByText("raw_field")).toBeInTheDocument();
    });
  });
});
