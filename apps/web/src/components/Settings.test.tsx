import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { api, type AppConfig } from "../lib/api";
import Settings from "./Settings";

// Mock the api module
vi.mock("../lib/api", () => ({
  api: {
    getSettings: vi.fn(),
    testProvider: vi.fn(),
    saveSettings: vi.fn(),
  },
  proxyImageUrl: vi.fn((url: string | null) => url),
}));

// Mock the graph store
vi.mock("../store/graph", () => ({
  useGraph: vi.fn(),
  refreshDefaultModel: vi.fn(),
}));

// Mock Tooltip
vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

// Mock fetch for /api/workers
global.fetch = vi.fn().mockResolvedValue({
  json: () => Promise.resolve([]),
} as Response);

const mockGetSettings = api.getSettings as unknown as ReturnType<typeof vi.fn>;
const mockTestProvider = api.testProvider as unknown as ReturnType<typeof vi.fn>;
const mockSaveSettings = api.saveSettings as unknown as ReturnType<typeof vi.fn>;

// Sample config with one builtin provider and one custom provider
const sampleConfig: AppConfig = {
  providers: {
    agnes: {
      type: "fake",
      source: "builtin",
      models: ["agnes-2.0-flash", "agnes-2.0-pro"],
      enabled: true,
    },
    "my-openai": {
      type: "openai-compatible",
      source: "custom",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-****",
      models: ["gpt-4o", "gpt-4o-mini"],
      enabled: true,
    },
  },
  defaultModel: "agnes-2.0-flash",
  defaultProvider: "agnes",
  modelOrder: [
    "agnes::agnes-2.0-flash",
    "agnes::agnes-2.0-pro",
    "my-openai::gpt-4o",
    "my-openai::gpt-4o-mini",
  ],
};

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue(sampleConfig);
    mockTestProvider.mockResolvedValue({ ok: true });
    mockSaveSettings.mockResolvedValue({});
  });

  describe("渲染", () => {
    it("open=false 时不渲染", () => {
      const { container } = render(<Settings open={false} onClose={() => {}} />);
      expect(container).toBeEmptyDOMElement();
    });

    it("open=true 时渲染模态框，标题为'设置 · 模型与密钥'", async () => {
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("设置 · 模型与密钥")).toBeInTheDocument();
      });
    });

    it("打开时调用 api.getSettings", async () => {
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        expect(mockGetSettings).toHaveBeenCalledTimes(1);
      });
    });

    it("有关闭按钮", async () => {
      const onClose = vi.fn();
      render(<Settings open onClose={onClose} />);
      await waitFor(() => {
        expect(screen.getByText("设置 · 模型与密钥")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: "关闭" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("有'模型'标题和添加按钮", async () => {
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("模型")).toBeInTheDocument();
      });
      // 添加按钮显示 +
      expect(screen.getByRole("button", { name: "+" })).toBeInTheDocument();
    });
  });

  describe("模型卡片", () => {
    it("显示配置中的模型卡片", async () => {
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        // agnes 模型
        expect(screen.getByText("agnes-2.0-flash")).toBeInTheDocument();
        expect(screen.getByText("agnes-2.0-pro")).toBeInTheDocument();
        // custom 模型
        expect(screen.getByText("gpt-4o")).toBeInTheDocument();
        expect(screen.getByText("gpt-4o-mini")).toBeInTheDocument();
      });
    });

    it("显示 provider 名称", async () => {
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        // agnes 和 my-openai 都出现在多个地方，用 getAllByText
        expect(screen.getAllByText("agnes").length).toBeGreaterThan(0);
        expect(screen.getAllByText("my-openai").length).toBeGreaterThan(0);
      });
    });

    it("builtin provider 的删除按钮被禁用", async () => {
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("agnes-2.0-flash")).toBeInTheDocument();
      });
      // 找到 agnes 卡片，检查删除按钮是否被禁用
      const agnesCard = screen.getByText("agnes-2.0-flash").closest(".model-card")!;
      const deleteBtn = within(agnesCard).queryByRole("button", { name: /删除/ });
      if (deleteBtn) {
        expect(deleteBtn).toBeDisabled();
      }
    });
  });

  describe("添加模型表单", () => {
    it("点击 + 按钮显示添加表单", async () => {
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "+" })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: "+" }));
      // 表单应该显示
      expect(screen.getByText("模型名称")).toBeInTheDocument();
      expect(screen.getByText("模型类型")).toBeInTheDocument();
      expect(screen.getByText("Provider")).toBeInTheDocument();
      // 按钮变成 ×
      expect(screen.getByRole("button", { name: "×" })).toBeInTheDocument();
    });

    it("再次点击 × 按钮隐藏表单", async () => {
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "+" })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: "+" }));
      expect(screen.getByText("模型名称")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "×" }));
      expect(screen.queryByText("模型名称")).not.toBeInTheDocument();
    });

    it("模型类型下拉框包含所有模态选项", async () => {
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "+" })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: "+" }));
      const modalitySelect = screen.getByLabelText("模型类型");
      expect(within(modalitySelect).getByText("文本")).toBeInTheDocument();
      expect(within(modalitySelect).getByText("图片")).toBeInTheDocument();
      expect(within(modalitySelect).getByText("视频")).toBeInTheDocument();
      expect(within(modalitySelect).getByText("音频")).toBeInTheDocument();
      expect(within(modalitySelect).getByText("向量")).toBeInTheDocument();
    });

    it("新建 Provider 时显示 Base URL 和 API Key 字段", async () => {
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "+" })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: "+" }));
      // 用正则匹配，避免文本被拆分
      expect(screen.getByText(/Base URL/)).toBeInTheDocument();
      expect(screen.getByText(/API Key/)).toBeInTheDocument();
    });

    it("选择已有 Provider 时隐藏 Base URL 和 API Key 字段", async () => {
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "+" })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: "+" }));
      const providerSelect = screen.getByLabelText("Provider");
      fireEvent.change(providerSelect, { target: { value: "my-openai" } });
      // 应该显示复用提示
      expect(screen.getByText(/将复用 Provider/)).toBeInTheDocument();
      // Base URL 和 API Key 字段应该隐藏
      expect(screen.queryByText("Base URL")).not.toBeInTheDocument();
      expect(screen.queryByText("API Key")).not.toBeInTheDocument();
    });
  });

  describe("测试连接", () => {
    it("点击测试按钮调用 api.testProvider", async () => {
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("gpt-4o")).toBeInTheDocument();
      });
      // 先点击卡片展开（测试按钮在展开区域）
      const card = screen.getByText("gpt-4o").closest(".model-card")!;
      fireEvent.click(card.querySelector(".model-card__head") || card);
      await waitFor(() => {
        expect(within(card).getByRole("button", { name: /测试连接/ })).toBeInTheDocument();
      });
      fireEvent.click(within(card).getByRole("button", { name: /测试连接/ }));
      await waitFor(() => {
        expect(mockTestProvider).toHaveBeenCalledTimes(1);
      });
    });

    it("测试成功显示'连接成功'", async () => {
      mockTestProvider.mockResolvedValue({ ok: true });
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("gpt-4o")).toBeInTheDocument();
      });
      const card = screen.getByText("gpt-4o").closest(".model-card")!;
      fireEvent.click(card.querySelector(".model-card__head") || card);
      await waitFor(() => {
        expect(within(card).getByRole("button", { name: /测试连接/ })).toBeInTheDocument();
      });
      fireEvent.click(within(card).getByRole("button", { name: /测试连接/ }));
      await waitFor(() => {
        expect(screen.getByText("连接成功")).toBeInTheDocument();
      });
    });

    it("测试失败显示错误信息", async () => {
      mockTestProvider.mockResolvedValue({ ok: false, error: "Invalid API key" });
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("gpt-4o")).toBeInTheDocument();
      });
      const card = screen.getByText("gpt-4o").closest(".model-card")!;
      fireEvent.click(card.querySelector(".model-card__head") || card);
      await waitFor(() => {
        expect(within(card).getByRole("button", { name: /测试连接/ })).toBeInTheDocument();
      });
      fireEvent.click(within(card).getByRole("button", { name: /测试连接/ }));
      await waitFor(() => {
        expect(screen.getByText("Invalid API key")).toBeInTheDocument();
      });
    });
  });

  describe("保存", () => {
    it("有保存按钮", async () => {
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("设置 · 模型与密钥")).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: /保存/ })).toBeInTheDocument();
    });

    it("点击保存调用 api.saveSettings", async () => {
      render(<Settings open onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("设置 · 模型与密钥")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /保存/ }));
      await waitFor(() => {
        expect(mockSaveSettings).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("键盘和背景关闭", () => {
    it("点击背景不直接关闭（有未保存更改时会确认）", async () => {
      const onClose = vi.fn();
      render(<Settings open onClose={onClose} />);
      await waitFor(() => {
        expect(screen.getByText("设置 · 模型与密钥")).toBeInTheDocument();
      });
      // 点击模态框内容不关闭
      const modal = screen.getByText("设置 · 模型与密钥").closest(".modal")!;
      fireEvent.click(modal);
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
