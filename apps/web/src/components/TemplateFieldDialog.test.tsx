import { render, screen, fireEvent } from "@testing-library/react";
import TemplateFieldDialog from "./TemplateFieldDialog";
import type { TemplateFieldData } from "./TemplatePicker";

const sampleFields: TemplateFieldData[] = [
  {
    key: "url",
    label: "目标链接",
    placeholder: "https://example.com",
    defaultValue: "https://default.example.com",
  },
  {
    key: "keyword",
    label: "关键词",
    placeholder: "输入关键词",
    defaultValue: "",
  },
  {
    key: "count",
    label: "数量",
    placeholder: "10",
    defaultValue: "5",
  },
];

function renderComponent(overrides: Partial<{
  templateName: string;
  fields: TemplateFieldData[];
  onCancel: () => void;
  onSubmit: (values: Record<string, string>) => void;
}> = {}) {
  const onCancel = vi.fn();
  const onSubmit = vi.fn();
  render(
    <TemplateFieldDialog
      templateName={overrides.templateName ?? "测试模板"}
      fields={overrides.fields ?? sampleFields}
      onCancel={overrides.onCancel ?? onCancel}
      onSubmit={overrides.onSubmit ?? onSubmit}
    />,
  );
  return { onCancel: overrides.onCancel ?? onCancel, onSubmit: overrides.onSubmit ?? onSubmit };
}

describe("TemplateFieldDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("渲染", () => {
    it("显示模板名称标题", () => {
      renderComponent();
      expect(screen.getByText("模板参数 — 测试模板")).toBeInTheDocument();
    });

    it("显示提示文字", () => {
      renderComponent();
      expect(screen.getByText("按需修改模板参数，保持默认值可直接创建。")).toBeInTheDocument();
    });

    it("显示所有字段标签", () => {
      renderComponent();
      expect(screen.getByText("目标链接")).toBeInTheDocument();
      expect(screen.getByText("关键词")).toBeInTheDocument();
      expect(screen.getByText("数量")).toBeInTheDocument();
    });

    it("显示所有字段输入框", () => {
      renderComponent();
      expect(screen.getByPlaceholderText("https://example.com")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("输入关键词")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("10")).toBeInTheDocument();
    });

    it("输入框预填 defaultValue", () => {
      renderComponent();
      expect(screen.getByPlaceholderText("https://example.com")).toHaveValue(
        "https://default.example.com",
      );
      expect(screen.getByPlaceholderText("10")).toHaveValue("5");
    });

    it("defaultValue 为空时输入框为空", () => {
      renderComponent();
      expect(screen.getByPlaceholderText("输入关键词")).toHaveValue("");
    });

    it("显示取消按钮", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    });

    it("显示创建产线按钮", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "创建产线" })).toBeInTheDocument();
    });

    it("有 modal-backdrop class", () => {
      renderComponent();
      expect(document.querySelector(".modal-backdrop")).toBeInTheDocument();
    });

    it("有 template-fields modal class", () => {
      renderComponent();
      expect(document.querySelector(".template-fields")).toBeInTheDocument();
    });
  });

  describe("交互", () => {
    it("修改输入框更新值", () => {
      renderComponent();
      const input = screen.getByPlaceholderText("https://example.com");
      fireEvent.change(input, { target: { value: "https://new.example.com" } });
      expect(input).toHaveValue("https://new.example.com");
    });

    it("修改空输入框更新值", () => {
      renderComponent();
      const input = screen.getByPlaceholderText("输入关键词");
      fireEvent.change(input, { target: { value: "新关键词" } });
      expect(input).toHaveValue("新关键词");
    });

    it("点击取消按钮调用 onCancel", () => {
      const { onCancel } = renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("点击创建产线按钮调用 onSubmit", () => {
      const { onSubmit } = renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "创建产线" }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("onSubmit 接收默认值", () => {
      const { onSubmit } = renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "创建产线" }));
      expect(onSubmit).toHaveBeenCalledWith({
        url: "https://default.example.com",
        keyword: "",
        count: "5",
      });
    });

    it("onSubmit 接收修改后的值", () => {
      const { onSubmit } = renderComponent();
      fireEvent.change(screen.getByPlaceholderText("https://example.com"), {
        target: { value: "https://modified.example.com" },
      });
      fireEvent.change(screen.getByPlaceholderText("输入关键词"), {
        target: { value: "测试关键词" },
      });
      fireEvent.click(screen.getByRole("button", { name: "创建产线" }));
      expect(onSubmit).toHaveBeenCalledWith({
        url: "https://modified.example.com",
        keyword: "测试关键词",
        count: "5",
      });
    });

    it("点击背景调用 onCancel", () => {
      const { onCancel } = renderComponent();
      const backdrop = document.querySelector(".modal-backdrop")!;
      fireEvent.click(backdrop);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("点击模态框内容不调用 onCancel", () => {
      const { onCancel } = renderComponent();
      const modal = document.querySelector(".template-fields")!;
      fireEvent.click(modal);
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe("空字段", () => {
    it("fields 为空时只显示标题和按钮", () => {
      renderComponent({ fields: [] });
      expect(screen.getByText("模板参数 — 测试模板")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "创建产线" })).toBeInTheDocument();
    });

    it("fields 为空时 onSubmit 接收空对象", () => {
      const { onSubmit } = renderComponent({ fields: [] });
      fireEvent.click(screen.getByRole("button", { name: "创建产线" }));
      expect(onSubmit).toHaveBeenCalledWith({});
    });
  });

  describe("单个字段", () => {
    it("单个字段正常渲染", () => {
      const singleField: TemplateFieldData[] = [
        { key: "url", label: "链接", placeholder: "https://", defaultValue: "" },
      ];
      renderComponent({ fields: singleField });
      expect(screen.getByText("链接")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("https://")).toBeInTheDocument();
    });
  });
});
