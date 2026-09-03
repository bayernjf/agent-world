import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { api } from "../lib/api";
import TriggersPanel from "./TriggersPanel";
import type { TriggerConfig, RunSummary } from "../lib/api";

// Mock api
vi.mock("../lib/api", () => ({
  api: {
    listTriggers: vi.fn(),
    triggerNextRuns: vi.fn(),
    listRuns: vi.fn(),
    fireTrigger: vi.fn(),
    deleteTrigger: vi.fn(),
    createTrigger: vi.fn(),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

// Mock crypto.randomUUID for blankTrigger
Object.defineProperty(globalThis, "crypto", {
  value: {
    randomUUID: () => "12345678-1234-1234-1234-123456789012",
  },
  writable: true,
});

const mockListTriggers = api.listTriggers as unknown as ReturnType<typeof vi.fn>;
const mockTriggerNextRuns = api.triggerNextRuns as unknown as ReturnType<typeof vi.fn>;
const mockListRuns = api.listRuns as unknown as ReturnType<typeof vi.fn>;
const mockFireTrigger = api.fireTrigger as unknown as ReturnType<typeof vi.fn>;
const mockDeleteTrigger = api.deleteTrigger as unknown as ReturnType<typeof vi.fn>;
const mockCreateTrigger = api.createTrigger as unknown as ReturnType<typeof vi.fn>;

const sampleTriggers: TriggerConfig[] = [
  { id: "trg_001", type: "cron", enabled: true, cron: "0 9 * * *" },
  { id: "trg_002", type: "webhook", enabled: true, webhookSecret: "secret123" },
  { id: "trg_003", type: "manual", enabled: true },
  { id: "trg_004", type: "cron", enabled: false, cron: "0 18 * * *" },
];

const sampleRuns: RunSummary[] = [
  {
    id: "run_001",
    graph_id: "g1",
    graph_name: "测试产线",
    status: "done",
    started_at: Date.now() - 3600000,
    ended_at: Date.now() - 3500000,
    trigger: "cron:trg_001",
  },
  {
    id: "run_002",
    graph_id: "g1",
    graph_name: "测试产线",
    status: "failed",
    started_at: Date.now() - 7200000,
    ended_at: Date.now() - 7100000,
    trigger: "manual",
  },
];

function setupMocks(triggers: TriggerConfig[] = sampleTriggers, runs: RunSummary[] = sampleRuns) {
  mockListTriggers.mockResolvedValue(triggers);
  mockTriggerNextRuns.mockResolvedValue({
    "trg_001": Date.now() + 86400000,
    "trg_004": null,
  });
  mockListRuns.mockResolvedValue({ runs, total: runs.length });
  mockFireTrigger.mockResolvedValue({ ok: true });
  mockDeleteTrigger.mockResolvedValue({ ok: true });
  mockCreateTrigger.mockResolvedValue({ ok: true });
}

function renderPanel(open = true, graphId = "g1") {
  const onClose = vi.fn();
  render(<TriggersPanel open={open} onClose={onClose} graphId={graphId} />);
  return { onClose };
}

async function renderAndWait(open = true, graphId = "g1") {
  const result = renderPanel(open, graphId);
  if (open) {
    await waitFor(() => {
      expect(mockListTriggers).toHaveBeenCalled();
    });
  }
  return result;
}

describe("TriggersPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(<TriggersPanel open={false} onClose={vi.fn()} graphId="g1" />);
      expect(container.firstChild).toBeNull();
    });

    it("open=true 时显示标题'触发器'", async () => {
      await renderAndWait();
      expect(screen.getByText("触发器")).toBeInTheDocument();
    });

    it("显示关闭按钮", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "✕" })).toBeInTheDocument();
    });

    it("显示'添加触发器'按钮", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: /添加触发器/ })).toBeInTheDocument();
    });

    it("显示说明文字", async () => {
      await renderAndWait();
      expect(screen.getByText(/配置自动运行/)).toBeInTheDocument();
    });

    it("调用 api.listTriggers、api.triggerNextRuns、api.listRuns", async () => {
      await renderAndWait();
      expect(mockListTriggers).toHaveBeenCalledWith("g1");
      expect(mockTriggerNextRuns).toHaveBeenCalledWith("g1");
      expect(mockListRuns).toHaveBeenCalled();
    });
  });

  describe("触发器列表", () => {
    it("空列表时显示提示", async () => {
      setupMocks([]);
      await renderAndWait();
      expect(screen.getByText(/暂无触发器/)).toBeInTheDocument();
    });

    it("显示所有触发器的类型标签", async () => {
      await renderAndWait();
      // "定时"出现两次（两个 cron 触发器）
      expect(screen.getAllByText("定时").length).toBe(2);
      expect(screen.getByText("Webhook")).toBeInTheDocument();
      expect(screen.getByText("手动")).toBeInTheDocument();
    });

    it("显示触发器 id", async () => {
      await renderAndWait();
      expect(screen.getByText("trg_001")).toBeInTheDocument();
      expect(screen.getByText("trg_002")).toBeInTheDocument();
    });

    it("cron 触发器显示 cron 表达式摘要", async () => {
      await renderAndWait();
      expect(screen.getByText("0 9 * * *")).toBeInTheDocument();
    });

    it("webhook 触发器显示 secret 摘要", async () => {
      await renderAndWait();
      expect(screen.getByText(/secret: secret123/)).toBeInTheDocument();
    });

    it("已停用的触发器显示'已停用'标签", async () => {
      await renderAndWait();
      expect(screen.getByText("已停用")).toBeInTheDocument();
    });

    it("每个触发器显示启用复选框", async () => {
      await renderAndWait();
      const checkboxes = screen.getAllByLabelText("启用");
      expect(checkboxes.length).toBe(4);
    });

    it("每个触发器显示'运行一次'按钮", async () => {
      await renderAndWait();
      const buttons = screen.getAllByRole("button", { name: "运行一次" });
      expect(buttons.length).toBe(4);
    });

    it("每个触发器显示'编辑'按钮", async () => {
      await renderAndWait();
      const buttons = screen.getAllByRole("button", { name: "编辑" });
      expect(buttons.length).toBe(4);
    });

    it("每个触发器显示'删除'按钮", async () => {
      await renderAndWait();
      const buttons = screen.getAllByRole("button", { name: "删除" });
      expect(buttons.length).toBe(4);
    });
  });

  describe("触发器操作", () => {
    it("点击'运行一次'调用 api.fireTrigger", async () => {
      await renderAndWait();
      const buttons = screen.getAllByRole("button", { name: "运行一次" });
      fireEvent.click(buttons[0]);
      await waitFor(() => {
        expect(mockFireTrigger).toHaveBeenCalledWith("g1", "trg_001");
      });
    });

    it("点击'删除'调用 api.deleteTrigger", async () => {
      await renderAndWait();
      const buttons = screen.getAllByRole("button", { name: "删除" });
      fireEvent.click(buttons[0]);
      await waitFor(() => {
        expect(mockDeleteTrigger).toHaveBeenCalledWith("g1", "trg_001");
      });
    });

    it("切换启用状态调用 api.createTrigger", async () => {
      await renderAndWait();
      const checkboxes = screen.getAllByLabelText("启用");
      fireEvent.click(checkboxes[0]);
      await waitFor(() => {
        expect(mockCreateTrigger).toHaveBeenCalled();
      });
    });

    it("点击'添加触发器'显示编辑表单", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: /添加触发器/ }));
      // TriggerEditor 应该显示"新建触发器"标题
      await waitFor(() => {
        expect(screen.getByText("新建触发器")).toBeInTheDocument();
      });
    });
  });

  describe("最近运行", () => {
    it("显示'最近运行'标题", async () => {
      await renderAndWait();
      expect(screen.getByText("最近运行")).toBeInTheDocument();
    });

    it("显示运行记录", async () => {
      await renderAndWait();
      expect(screen.getByText("done")).toBeInTheDocument();
      expect(screen.getByText("failed")).toBeInTheDocument();
    });

    it("显示触发方式", async () => {
      await renderAndWait();
      expect(screen.getByText(/触发：cron:trg_001/)).toBeInTheDocument();
      expect(screen.getByText(/触发：manual/)).toBeInTheDocument();
    });

    it("空运行列表显示提示", async () => {
      setupMocks(sampleTriggers, []);
      await renderAndWait();
      expect(screen.getByText("暂无运行记录。")).toBeInTheDocument();
    });
  });

  describe("关闭", () => {
    it("点击关闭按钮调用 onClose", async () => {
      const { onClose } = await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "✕" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击背景调用 onClose", async () => {
      const { onClose } = await renderAndWait();
      const backdrop = document.querySelector(".modal-backdrop")!;
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击模态框内容不调用 onClose", async () => {
      const { onClose } = await renderAndWait();
      const modal = document.querySelector(".modal")!;
      fireEvent.click(modal);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("按 Escape 键调用 onClose", async () => {
      const { onClose } = await renderAndWait();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("错误处理", () => {
    it("加载失败时显示错误信息", async () => {
      mockListTriggers.mockRejectedValue(new Error("网络错误"));
      await renderAndWait();
      await waitFor(() => {
        expect(screen.getByText("网络错误")).toBeInTheDocument();
      });
    });
  });
});
