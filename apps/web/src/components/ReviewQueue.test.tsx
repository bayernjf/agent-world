import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { PendingReview, ReviewDecisionResult } from "../lib/api";
import { useToast } from "../store/toast";
import ReviewQueue from "./ReviewQueue";

vi.mock("../lib/api", () => ({
  api: {
    listPendingReviews: vi.fn(),
    decideReviews: vi.fn(),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockList = api.listPendingReviews as unknown as ReturnType<typeof vi.fn>;
const mockDecide = api.decideReviews as unknown as ReturnType<typeof vi.fn>;

const NOW = 1_700_000_000_000;

function mkReview(over: Partial<PendingReview> = {}): PendingReview {
  return {
    runId: "run-1",
    graphId: "graph-1",
    graphName: "春季文案产线",
    nodeId: "hu",
    nodeName: "人工审核",
    kind: "human",
    reason: "确认可否发布",
    content: "春季新款连衣裙，轻盈透气",
    contentTruncated: false,
    detail: null,
    tool: null,
    startedAt: NOW - 120_000,
    haltedAt: NOW - 60_000,
    waitingMs: 60_000,
    trigger: "manual",
    abGroup: null,
    abArm: null,
    ...over,
  };
}

function ok(runId: string, action = "approve"): ReviewDecisionResult {
  return { runId, ok: true, action } as ReviewDecisionResult;
}

function setup(reviews: PendingReview[] = [mkReview()], total = reviews.length) {
  mockList.mockResolvedValue({ reviews, total });
  mockDecide.mockResolvedValue({ ok: true, results: reviews.map((r) => ok(r.runId)) });
}

/** Lets promise-driven state updates (the list fetch, a decision) land inside act. */
async function flush() {
  await act(async () => {});
}

async function renderQueue(open = true) {
  const onClose = vi.fn();
  const onOpenRun = vi.fn();
  const onChanged = vi.fn();
  render(
    <ReviewQueue open={open} onClose={onClose} onOpenRun={onOpenRun} onChanged={onChanged} />,
  );
  if (open) {
    await screen.findByText("审核队列");
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await flush();
  }
  return { onClose, onOpenRun, onChanged };
}

describe("ReviewQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToast.getState().clear();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    setup();
  });

  afterEach(async () => {
    await flush();
    vi.restoreAllMocks();
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(<ReviewQueue open={false} onClose={vi.fn()} />);
      expect(container).toBeEmptyDOMElement();
    });

    it("打开时拉取待审列表并显示标题", async () => {
      await renderQueue();
      expect(mockList).toHaveBeenCalledWith({ limit: 100 });
      expect(screen.getByText("审核队列")).toBeInTheDocument();
    });

    it("显示产线名、节点名、待审内容与等待时长", async () => {
      await renderQueue();
      expect(screen.getByText("春季文案产线")).toBeInTheDocument();
      expect(screen.getByText("人工审核")).toBeInTheDocument();
      expect(screen.getByText("春季新款连衣裙，轻盈透气")).toBeInTheDocument();
      expect(screen.getByText("已等待 1m 0s")).toBeInTheDocument();
    });

    it("按暂停类型显示徽标", async () => {
      setup([
        mkReview({ runId: "run-h" }),
        mkReview({ runId: "run-t", kind: "tool", tool: "shell", content: null, reason: null }),
        mkReview({ runId: "run-g", kind: "gate", detail: "文案与商品不符", reason: null }),
      ]);
      await renderQueue();
      expect(screen.getByText("人工确认")).toBeInTheDocument();
      expect(screen.getByText("危险操作")).toBeInTheDocument();
      expect(screen.getByText("质检未过")).toBeInTheDocument();
      expect(screen.getByText("shell")).toBeInTheDocument();
      expect(screen.getByText("文案与商品不符")).toBeInTheDocument();
    });

    it("没有记录节点的运行标注为未记录，并且不能定向修改", async () => {
      setup([mkReview({ nodeId: null, nodeName: null })]);
      await renderQueue();
      expect(screen.getByText("未记录节点")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "改后通过" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "改后通过" })).toHaveAttribute(
        "title",
        "这条运行没有记录暂停节点，无法定向修改",
      );
    });

    it("没有待审文本时给出说明", async () => {
      setup([mkReview({ content: null })]);
      await renderQueue();
      expect(screen.getByText("这条运行没有记录待审文本")).toBeInTheDocument();
    });

    it("内容被截断时说明只显示前若干字", async () => {
      setup([mkReview({ content: "x".repeat(1200), contentTruncated: true })]);
      await renderQueue();
      expect(screen.getByText("内容较长，只显示前 1200 字")).toBeInTheDocument();
    });

    it("空队列显示提示", async () => {
      setup([]);
      await renderQueue();
      expect(screen.getByText("没有等待审核的运行")).toBeInTheDocument();
    });

    it("服务端报告的总数超过本页时说明只显示前 N 条", async () => {
      setup([mkReview()], 130);
      await renderQueue();
      expect(screen.getByText("只显示前 1 条，共 130 条")).toBeInTheDocument();
    });

    it("加载失败显示错误", async () => {
      mockList.mockRejectedValue(new Error("401 unauthorized"));
      render(<ReviewQueue open onClose={vi.fn()} />);
      await flush();
      expect(
        screen.getByText("加载审核队列失败：401 unauthorized"),
      ).toBeInTheDocument();
    });
  });

  describe("单条决策", () => {
    it("点通过提交 approve", async () => {
      await renderQueue();
      fireEvent.click(screen.getByRole("button", { name: "通过" }));
      await flush();
      expect(mockDecide).toHaveBeenCalledTimes(1);
      expect(mockDecide).toHaveBeenCalledWith([{ runId: "run-1", action: "approve" }]);
    });

    it("危险操作的通过要带上待批准工具", async () => {
      setup([mkReview({ kind: "tool", tool: "shell", content: null })]);
      await renderQueue();
      fireEvent.click(screen.getByRole("button", { name: "通过" }));
      await flush();
      expect(mockDecide).toHaveBeenCalledWith([
        { runId: "run-1", action: "approve", approveTools: ["shell"] },
      ]);
    });

    it("危险操作不提供改后通过", async () => {
      setup([mkReview({ kind: "tool", tool: "shell", content: null })]);
      await renderQueue();
      expect(screen.queryByRole("button", { name: "改后通过" })).not.toBeInTheDocument();
    });

    it("拒绝前先确认，取消则不提交", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      await renderQueue();
      fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
      expect(window.confirm).toHaveBeenCalledWith("驳回 1 条待审运行？这些运行将以失败结束。");
      expect(mockDecide).not.toHaveBeenCalled();
    });

    it("确认后提交 reject，报废提交 scrap", async () => {
      await renderQueue();
      fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
      await flush();
      expect(mockDecide).toHaveBeenCalledWith([{ runId: "run-1", action: "reject" }]);
      // flush also clears the in-flight flag, so the row is actionable again.
      fireEvent.click(screen.getByRole("button", { name: "废弃" }));
      await flush();
      expect(mockDecide).toHaveBeenCalledWith([{ runId: "run-1", action: "scrap" }]);
    });

    it("改后通过打开编辑器，预填待审内容并按节点提交", async () => {
      await renderQueue();
      fireEvent.click(screen.getByRole("button", { name: "改后通过" }));
      const box = await screen.findByRole("textbox");
      expect(box).toHaveValue("春季新款连衣裙，轻盈透气");
      fireEvent.change(box, { target: { value: "人工改过的合规文案" } });
      fireEvent.click(screen.getByRole("button", { name: "保存并通过" }));
      await flush();
      expect(mockDecide).toHaveBeenCalledWith([
        {
          runId: "run-1",
          action: "edit",
          editOutput: { hu: "人工改过的合规文案" },
        },
      ]);
    });

    it("取消编辑回到操作按钮", async () => {
      await renderQueue();
      fireEvent.click(screen.getByRole("button", { name: "改后通过" }));
      await screen.findByRole("textbox");
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "通过" })).toBeInTheDocument();
    });

    it("点打开运行回调 runId", async () => {
      const { onOpenRun } = await renderQueue();
      fireEvent.click(screen.getByRole("button", { name: "打开运行" }));
      expect(onOpenRun).toHaveBeenCalledWith("run-1");
    });

    it("提交成功后刷新列表并通知调用方", async () => {
      const { onChanged } = await renderQueue();
      const callsBefore = mockList.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "通过" }));
      await flush();
      expect(mockList.mock.calls.length).toBe(callsBefore + 1);
      expect(onChanged).toHaveBeenCalledTimes(1);
    });

    it("成功的决策弹提示", async () => {
      await renderQueue();
      fireEvent.click(screen.getByRole("button", { name: "通过" }));
      await flush();
      expect(useToast.getState().toast?.message).toBe("已提交 1 条决策");
    });

    it("部分失败时报告失败条数与原因", async () => {
      setup([mkReview({ runId: "run-1" }), mkReview({ runId: "run-2" })]);
      mockDecide.mockResolvedValue({
        ok: true,
        results: [
          { runId: "run-1", ok: true, action: "approve" },
          { runId: "run-2", ok: false, status: 409, error: "运行已在处理中" },
        ],
      });
      await renderQueue();
      fireEvent.click(screen.getByRole("button", { name: "批量选择" }));
      const boxes = screen.getAllByRole("checkbox");
      fireEvent.click(boxes[0]!);
      fireEvent.click(boxes[1]!);
      fireEvent.click(screen.getByRole("button", { name: "批量通过 (2)" }));
      await flush();
      const msg = useToast.getState().toast?.message ?? "";
      expect(msg).toContain("1 条决策失败");
      expect(msg).toContain("运行已在处理中");
    });

    it("接口整体失败时显示错误而不抛异常", async () => {
      mockDecide.mockRejectedValue(new Error("400 第 1 条缺少 runId"));
      await renderQueue();
      fireEvent.click(screen.getByRole("button", { name: "通过" }));
      await flush();
      expect(
        screen.getByText("提交决策失败：400 第 1 条缺少 runId"),
      ).toBeInTheDocument();
    });
  });

  describe("批量选择", () => {
    it("进入批量选择后出现复选框，退出后消失", async () => {
      setup([mkReview({ runId: "run-1" }), mkReview({ runId: "run-2" })]);
      await renderQueue();
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: "批量选择" }));
      expect(screen.getAllByRole("checkbox")).toHaveLength(2);
      expect(screen.getByRole("button", { name: "退出选择" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "退出选择" }));
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    });

    it("勾选两条后批量通过提交两条决策", async () => {
      setup([mkReview({ runId: "run-1" }), mkReview({ runId: "run-2", kind: "tool", tool: "shell", content: null })]);
      await renderQueue();
      fireEvent.click(screen.getByRole("button", { name: "批量选择" }));
      expect(screen.getByText("已选 0 条")).toBeInTheDocument();
      const boxes = screen.getAllByRole("checkbox");
      fireEvent.click(boxes[0]!);
      fireEvent.click(boxes[1]!);
      expect(screen.getByText("已选 2 条")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "批量通过 (2)" }));
      await flush();
      expect(mockDecide).toHaveBeenCalledWith([
        { runId: "run-1", action: "approve" },
        { runId: "run-2", action: "approve", approveTools: ["shell"] },
      ]);
    });

    it("未勾选时批量通过不可点", async () => {
      setup([mkReview({ runId: "run-1" }), mkReview({ runId: "run-2" })]);
      await renderQueue();
      fireEvent.click(screen.getByRole("button", { name: "批量选择" }));
      expect(screen.getByRole("button", { name: "批量通过 (0)" })).toBeDisabled();
    });
  });

  describe("快捷键", () => {
    const modal = () => document.querySelector(".modal") as HTMLElement;

    it("面板上列出 A / R / E / Esc", async () => {
      await renderQueue();
      const hint = document.querySelector(".reviewqueue__hint") as HTMLElement;
      expect(hint).toBeInTheDocument();
      expect(Array.from(hint.querySelectorAll("kbd")).map((k) => k.textContent)).toEqual([
        "A",
        "R",
        "E",
        "Esc",
      ]);
      expect(hint.textContent).toContain("改后通过");
    });

    it("A 通过等待最久的一条", async () => {
      setup([mkReview({ runId: "run-1" }), mkReview({ runId: "run-2" })]);
      await renderQueue();
      fireEvent.keyDown(modal(), { key: "a" });
      await flush();
      expect(mockDecide).toHaveBeenCalledWith([{ runId: "run-1", action: "approve" }]);
    });

    it("同一条运行在处理中时不会重复提交", async () => {
      await renderQueue();
      fireEvent.keyDown(modal(), { key: "a" });
      fireEvent.keyDown(modal(), { key: "a" });
      await flush();
      expect(mockDecide).toHaveBeenCalledTimes(1);
    });

    it("R 拒绝，E 打开编辑器", async () => {
      await renderQueue();
      fireEvent.keyDown(modal(), { key: "r" });
      await flush();
      expect(mockDecide).toHaveBeenCalledWith([{ runId: "run-1", action: "reject" }]);
      fireEvent.keyDown(modal(), { key: "E" });
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("方向键切换快捷键作用的行", async () => {
      setup([mkReview({ runId: "run-1" }), mkReview({ runId: "run-2" })]);
      await renderQueue();
      fireEvent.keyDown(modal(), { key: "ArrowDown" });
      fireEvent.keyDown(modal(), { key: "a" });
      await flush();
      expect(mockDecide).toHaveBeenCalledWith([{ runId: "run-2", action: "approve" }]);
    });

    it("勾选后 A 作用于所有勾选行", async () => {
      setup([mkReview({ runId: "run-1" }), mkReview({ runId: "run-2" })]);
      await renderQueue();
      fireEvent.click(screen.getByRole("button", { name: "批量选择" }));
      const boxes = screen.getAllByRole("checkbox");
      fireEvent.click(boxes[1]!);
      fireEvent.keyDown(modal(), { key: "a" });
      await flush();
      expect(mockDecide).toHaveBeenCalledWith([{ runId: "run-2", action: "approve" }]);
    });

    it("Esc 关闭队列", async () => {
      const { onClose } = await renderQueue();
      fireEvent.keyDown(modal(), { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("在编辑器里打字不触发快捷键", async () => {
      await renderQueue();
      fireEvent.click(screen.getByRole("button", { name: "改后通过" }));
      const box = await screen.findByRole("textbox");
      fireEvent.keyDown(box, { key: "a" });
      expect(mockDecide).not.toHaveBeenCalled();
    });

    it("带修饰键的组合不被拦截", async () => {
      await renderQueue();
      fireEvent.keyDown(modal(), { key: "a", metaKey: true });
      expect(mockDecide).not.toHaveBeenCalled();
    });
  });

  describe("关闭与刷新", () => {
    it("点关闭按钮、点背景都调用 onClose，点内容不关闭", async () => {
      const { onClose } = await renderQueue();
      fireEvent.click(document.querySelector(".modal")!);
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.click(document.querySelector(".modal-backdrop")!);
      expect(onClose).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "关闭" }));
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it("点刷新重新拉取列表", async () => {
      await renderQueue();
      const before = mockList.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "刷新" }));
      await waitFor(() => expect(mockList.mock.calls.length).toBe(before + 1));
    });
  });
});
