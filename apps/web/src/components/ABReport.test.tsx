import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import ABReport from "./ABReport";
import type { ABReport as Report } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: {
    abReport: vi.fn(),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockAbReport = api.abReport as unknown as ReturnType<typeof vi.fn>;

const sampleReport: Report = {
  groupId: "ab-group-001",
  recommendedArm: "A",
  arms: [
    {
      arm: "A",
      target: "prompt-v1",
      prompt: "你是一个专业的文案写手",
      runs: 10,
      done: 10,
      passed: 9,
      passRate: 0.9,
      avgRework: 1.2,
      avgDurationMs: 45000,
      avgScore: 8.5,
      avgCost: 0.0123,
    },
    {
      arm: "B",
      target: "prompt-v2",
      prompt: "你是一个创意营销专家",
      runs: 10,
      done: 8,
      passed: 6,
      passRate: 0.75,
      avgRework: 1.8,
      avgDurationMs: 52000,
      avgScore: 7.8,
      avgCost: 0.0156,
    },
  ],
};

function setupMocks(report: Report | null = sampleReport) {
  if (report) {
    mockAbReport.mockResolvedValue(report);
  } else {
    mockAbReport.mockResolvedValue({ groupId: "ab-group-001", recommendedArm: null, arms: [] });
  }
}

function renderModal(open = true, groupId = "ab-group-001") {
  const onClose = vi.fn();
  render(<ABReport open={open} groupId={groupId} onClose={onClose} />);
  return { onClose };
}

async function renderAndWait(open = true, groupId = "ab-group-001") {
  const result = renderModal(open, groupId);
  if (open) {
    await waitFor(() => {
      expect(mockAbReport).toHaveBeenCalled();
    });
  }
  return result;
}

describe("ABReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(<ABReport open={false} groupId="g1" onClose={vi.fn()} />);
      expect(container.firstChild).toBeNull();
    });

    it("open=true 时显示标题'A/B 实验对比'", async () => {
      await renderAndWait();
      expect(screen.getByText("A/B 实验对比")).toBeInTheDocument();
    });

    it("显示刷新按钮", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
    });

    it("显示关闭按钮", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "✕" })).toBeInTheDocument();
    });

    it("显示实验组 ID", async () => {
      await renderAndWait();
      expect(screen.getByText("ab-group-001")).toBeInTheDocument();
    });

    it("调用 api.abReport", async () => {
      await renderAndWait();
      expect(mockAbReport).toHaveBeenCalledWith("ab-group-001");
    });
  });

  describe("加载状态", () => {
    it("加载中显示'加载中…'", () => {
      mockAbReport.mockReturnValue(new Promise(() => {}));
      renderModal();
      expect(screen.getByText("加载中…")).toBeInTheDocument();
    });

    it("无实验数据时显示'没有实验数据。'", async () => {
      setupMocks(null);
      await renderAndWait();
      expect(screen.getByText("没有实验数据。")).toBeInTheDocument();
    });
  });

  describe("对比表格", () => {
    it("显示表格表头", async () => {
      await renderAndWait();
      expect(screen.getByText("臂")).toBeInTheDocument();
      expect(screen.getByText("Prompt 变体")).toBeInTheDocument();
      expect(screen.getByText("运行")).toBeInTheDocument();
      expect(screen.getByText("合格率")).toBeInTheDocument();
      expect(screen.getByText("质量分")).toBeInTheDocument();
      expect(screen.getByText("平均返工")).toBeInTheDocument();
      expect(screen.getByText("平均耗时")).toBeInTheDocument();
      expect(screen.getByText("单跑成本")).toBeInTheDocument();
    });

    it("显示所有臂的标签", async () => {
      await renderAndWait();
      expect(screen.getByText("A")).toBeInTheDocument();
      expect(screen.getByText("B")).toBeInTheDocument();
    });

    it("显示 Prompt 变体", async () => {
      await renderAndWait();
      expect(screen.getByText("你是一个专业的文案写手")).toBeInTheDocument();
      expect(screen.getByText("你是一个创意营销专家")).toBeInTheDocument();
    });

    it("显示运行次数", async () => {
      await renderAndWait();
      // 两个臂都是 10 次运行
      expect(screen.getAllByText("10").length).toBeGreaterThan(0);
    });

    it("显示合格率", async () => {
      await renderAndWait();
      expect(screen.getByText("90%")).toBeInTheDocument();
      expect(screen.getByText("75%")).toBeInTheDocument();
    });

    it("显示质量分", async () => {
      await renderAndWait();
      expect(screen.getByText("8.50")).toBeInTheDocument();
      expect(screen.getByText("7.80")).toBeInTheDocument();
    });

    it("显示平均返工", async () => {
      await renderAndWait();
      expect(screen.getByText("1.20")).toBeInTheDocument();
      expect(screen.getByText("1.80")).toBeInTheDocument();
    });

    it("显示平均耗时", async () => {
      await renderAndWait();
      expect(screen.getByText("45.0s")).toBeInTheDocument();
      expect(screen.getByText("52.0s")).toBeInTheDocument();
    });

    it("显示单跑成本", async () => {
      await renderAndWait();
      expect(screen.getByText("$0.0123")).toBeInTheDocument();
      expect(screen.getByText("$0.0156")).toBeInTheDocument();
    });
  });

  describe("推荐臂", () => {
    it("推荐臂显示'推荐'徽章", async () => {
      await renderAndWait();
      expect(screen.getByText("推荐")).toBeInTheDocument();
    });

    it("推荐臂行有 winner class", async () => {
      await renderAndWait();
      const rows = screen.getAllByRole("row");
      // 第一行是表头，第二行是 A 臂（推荐）
      expect(rows[1]).toHaveClass("winner");
    });

    it("全部完成时显示推荐建议", async () => {
      // 修改 mock 数据，让所有臂都完成
      const allDoneReport: Report = {
        ...sampleReport,
        arms: sampleReport.arms.map((a) => ({ ...a, done: a.runs })),
      };
      setupMocks(allDoneReport);
      await renderAndWait();
      const winnerNote = screen.getByText(/建议采用/);
      expect(winnerNote).toBeInTheDocument();
      expect(winnerNote).toHaveTextContent(/A/);
    });
  });

  describe("运行状态", () => {
    it("运行中的臂显示'运行中 X/Y'徽章", async () => {
      await renderAndWait();
      expect(screen.getByText("运行中 8/10")).toBeInTheDocument();
    });

    it("完成的臂显示'完成'徽章", async () => {
      await renderAndWait();
      expect(screen.getByText("完成")).toBeInTheDocument();
    });

    it("部分臂运行中显示'部分臂仍在运行'提示", async () => {
      await renderAndWait();
      expect(screen.getByText(/部分臂仍在运行/)).toBeInTheDocument();
    });
  });

  describe("合格率颜色编码", () => {
    it("高合格率(>=90%)使用 good 样式", async () => {
      await renderAndWait();
      const rate = screen.getByText("90%");
      expect(rate.closest("td")).toHaveClass("eval-rate--good");
    });

    it("中合格率(60-90%)使用 warn 样式", async () => {
      await renderAndWait();
      const rate = screen.getByText("75%");
      expect(rate.closest("td")).toHaveClass("eval-rate--warn");
    });
  });

  describe("刷新", () => {
    it("点击刷新按钮调用 api.abReport", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "刷新" }));
      await waitFor(() => {
        expect(mockAbReport).toHaveBeenCalledTimes(2);
      });
    });

    it("自动刷新每 2 秒调用一次", async () => {
      vi.useFakeTimers();
      try {
        renderModal();
        await vi.waitFor(() => {
          expect(mockAbReport).toHaveBeenCalledTimes(1);
        });
        vi.advanceTimersByTime(2000);
        await vi.waitFor(() => {
          expect(mockAbReport).toHaveBeenCalledTimes(2);
        });
      } finally {
        vi.useRealTimers();
      }
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
});
