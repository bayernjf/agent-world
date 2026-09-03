import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Onboarding from "./Onboarding";

// Mock api
const mockListGraphs = vi.fn();
vi.mock("../lib/api", () => ({
  api: {
    listGraphs: () => mockListGraphs(),
  },
}));

// Mock TemplatePicker
vi.mock("./TemplatePicker", () => ({
  default: ({ templates, blankFirst, onPick, cardClass }: any) => (
    <div data-testid="template-picker" data-blank-first={blankFirst ? "true" : "false"} data-card-class={cardClass ?? ""}>
      <button onClick={() => onPick(undefined)}>空白产线</button>
      <button onClick={() => onPick("tpl-simple")}>简单模板</button>
      <button onClick={() => onPick("tpl-with-fields")}>带参数模板</button>
    </div>
  ),
  TEMPLATE_LIST: [
    { id: "tpl-simple", name: "简单模板", fields: [] },
    { id: "tpl-with-fields", name: "带参数模板", fields: [{ key: "url", label: "链接", defaultValue: "" }] },
  ],
}));

// Mock TemplateFieldDialog
vi.mock("./TemplateFieldDialog", () => ({
  default: ({ templateName, fields, onCancel, onSubmit }: any) => (
    <div data-testid="template-field-dialog" data-template-name={templateName}>
      <span>参数表单: {templateName}</span>
      <button onClick={() => onCancel()}>取消参数</button>
      <button onClick={() => onSubmit({ url: "https://example.com" })}>提交参数</button>
    </div>
  ),
}));

function renderComponent(onCreate: (templateId?: string, fieldValues?: Record<string, string>) => void = vi.fn()) {
  return render(<Onboarding onCreate={onCreate} />);
}

describe("Onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListGraphs.mockResolvedValue([]);
  });

  describe("渲染", () => {
    it("显示欢迎标题", () => {
      renderComponent();
      expect(screen.getByText("欢迎来到 Agent World")).toBeInTheDocument();
    });

    it("显示副标题", () => {
      renderComponent();
      expect(screen.getByText(/用可视化的方式编排多 Agent 工作流/)).toBeInTheDocument();
    });

    it("显示模板选择区域标题", () => {
      renderComponent();
      expect(screen.getByText("从空白产线开始，或选择一个模板")).toBeInTheDocument();
    });

    it("显示模板数量提示", () => {
      renderComponent();
      expect(screen.getByText(/共 2 个模板/)).toBeInTheDocument();
    });

    it("渲染 TemplatePicker", () => {
      renderComponent();
      expect(screen.getByTestId("template-picker")).toBeInTheDocument();
    });

    it("TemplatePicker 设置 blankFirst", () => {
      renderComponent();
      expect(screen.getByTestId("template-picker")).toHaveAttribute("data-blank-first", "true");
    });

    it("TemplatePicker 设置 cardClass=onboarding", () => {
      renderComponent();
      expect(screen.getByTestId("template-picker")).toHaveAttribute("data-card-class", "onboarding");
    });

    it("显示配置模型提示", () => {
      renderComponent();
      expect(screen.getByText(/运行产线前需要在设置/)).toBeInTheDocument();
    });

    it("有 onboarding class", () => {
      renderComponent();
      expect(document.querySelector(".onboarding")).toBeInTheDocument();
    });

    it("有 onboarding__content class", () => {
      renderComponent();
      expect(document.querySelector(".onboarding__content")).toBeInTheDocument();
    });

    it("有 onboarding__hero class", () => {
      renderComponent();
      expect(document.querySelector(".onboarding__hero")).toBeInTheDocument();
    });

    it("有 onboarding__title class", () => {
      renderComponent();
      expect(document.querySelector(".onboarding__title")).toBeInTheDocument();
    });

    it("有 onboarding__subtitle class", () => {
      renderComponent();
      expect(document.querySelector(".onboarding__subtitle")).toBeInTheDocument();
    });

    it("有 onboarding__section class", () => {
      renderComponent();
      expect(document.querySelector(".onboarding__section")).toBeInTheDocument();
    });

    it("有 onboarding__tips class", () => {
      renderComponent();
      expect(document.querySelector(".onboarding__tips")).toBeInTheDocument();
    });
  });

  describe("模板选择", () => {
    it("选择空白产线调用 onCreate(undefined)", () => {
      const onCreate = vi.fn();
      renderComponent(onCreate);
      fireEvent.click(screen.getByText("空白产线"));
      expect(onCreate).toHaveBeenCalledWith(undefined);
    });

    it("选择无 fields 的模板直接调用 onCreate(id)", () => {
      const onCreate = vi.fn();
      renderComponent(onCreate);
      fireEvent.click(screen.getByText("简单模板"));
      expect(onCreate).toHaveBeenCalledWith("tpl-simple");
    });

    it("选择有 fields 的模板显示参数表单", () => {
      renderComponent();
      fireEvent.click(screen.getByText("带参数模板"));
      expect(screen.getByTestId("template-field-dialog")).toBeInTheDocument();
      expect(screen.getByText("参数表单: 带参数模板")).toBeInTheDocument();
    });

    it("选择有 fields 的模板不直接调用 onCreate", () => {
      const onCreate = vi.fn();
      renderComponent(onCreate);
      fireEvent.click(screen.getByText("带参数模板"));
      expect(onCreate).not.toHaveBeenCalled();
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

    it("参数表单提交后调用 onCreate(id, values)", () => {
      const onCreate = vi.fn();
      renderComponent(onCreate);
      fireEvent.click(screen.getByText("带参数模板"));
      fireEvent.click(screen.getByText("提交参数"));
      expect(onCreate).toHaveBeenCalledWith("tpl-with-fields", { url: "https://example.com" });
    });

    it("参数表单提交后关闭表单", () => {
      renderComponent();
      fireEvent.click(screen.getByText("带参数模板"));
      fireEvent.click(screen.getByText("提交参数"));
      expect(screen.queryByTestId("template-field-dialog")).not.toBeInTheDocument();
    });
  });

  describe("API 状态", () => {
    it("API 正常时不显示警告", async () => {
      mockListGraphs.mockResolvedValue([]);
      renderComponent();
      await waitFor(() => {
        expect(mockListGraphs).toHaveBeenCalled();
      });
      expect(screen.queryByText(/后端引擎未响应/)).not.toBeInTheDocument();
    });

    it("API 失败时显示警告", async () => {
      mockListGraphs.mockRejectedValue(new Error("Connection refused"));
      renderComponent();
      await waitFor(() => {
        expect(screen.getByText(/后端引擎未响应/)).toBeInTheDocument();
      });
    });

    it("API 失败警告包含启动命令", async () => {
      mockListGraphs.mockRejectedValue(new Error("Connection refused"));
      renderComponent();
      await waitFor(() => {
        expect(screen.getByText(/pnpm --filter @agent-world\/server dev/)).toBeInTheDocument();
      });
    });

    it("API 失败警告有 onboarding__tip-warn class", async () => {
      mockListGraphs.mockRejectedValue(new Error("Connection refused"));
      renderComponent();
      await waitFor(() => {
        expect(document.querySelector(".onboarding__tip-warn")).toBeInTheDocument();
      });
    });

    it("组件挂载时调用 api.listGraphs", async () => {
      renderComponent();
      await waitFor(() => {
        expect(mockListGraphs).toHaveBeenCalledTimes(1);
      });
    });
  });
});
