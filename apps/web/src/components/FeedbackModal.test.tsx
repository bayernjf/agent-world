import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FeedbackModal from "./FeedbackModal";
import { api } from "../lib/api";

const { mockShow } = vi.hoisted(() => ({ mockShow: vi.fn() }));

vi.mock("../lib/api", () => ({
  api: {
    submitFeedback: vi.fn(),
  },
}));

vi.mock("../store/toast", () => ({
  useToast: (selector: (s: { show: unknown }) => unknown) => selector({ show: mockShow }),
}));

vi.mock("../store/run", () => ({
  useRun: { getState: () => ({ runId: "run-1234" }) },
}));

const mockSubmit = api.submitFeedback as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockSubmit.mockResolvedValue({ ok: true, id: "f-1" });
});

function renderModal(open = true) {
  const onClose = vi.fn();
  render(<FeedbackModal open={open} onClose={onClose} />);
  return { onClose };
}

describe("FeedbackModal", () => {
  it("open=false 不渲染", () => {
    renderModal(false);
    expect(screen.queryByText("发送反馈")).not.toBeInTheDocument();
  });

  it("渲染表单：消息、四类分类、截图提示、诊断勾选默认开启", () => {
    renderModal();
    expect(screen.getByText("发送反馈")).toBeInTheDocument();
    expect(screen.getByLabelText(/说说遇到的问题或想法/)).toBeInTheDocument();
    expect(screen.getByLabelText("缺陷")).toBeChecked();
    expect(screen.getByLabelText("功能建议")).not.toBeChecked();
    expect(screen.getByLabelText("体验问题")).not.toBeChecked();
    expect(screen.getByLabelText("其他")).not.toBeChecked();
    expect(screen.getByText(/截图（可选，直接粘贴）/)).toBeInTheDocument();
    expect(screen.getByLabelText(/附带诊断信息/)).toBeChecked();
  });

  it("空消息提交显示校验提示，不调 API", async () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(screen.getByText("请先描述问题")).toBeInTheDocument();
    });
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("提交成功：带默认分类与上下文白名单，toast 并关闭", async () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByLabelText(/说说遇到的问题或想法/), {
      target: { value: "导出按钮没反应" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledTimes(1);
    });
    const [message, category, context] = mockSubmit.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
      unknown,
    ];
    expect(message).toBe("导出按钮没反应");
    expect(category).toBe("bug");
    // 白名单上下文：route/userAgent/locale 自动携带
    expect(context.route).toBe("/");
    expect(context.userAgent).toBeTruthy();
    expect(context.locale).toBeTruthy();
    // 诊断勾选开启时附带 lastRunId
    expect(context.lastRunId).toBe("run-1234");
    expect(mockShow).toHaveBeenCalledWith("已收到，感谢反馈");
    expect(onClose).toHaveBeenCalled();
  });

  it("关闭诊断勾选后不附带 lastRunId/lastError", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/说说遇到的问题或想法/), {
      target: { value: "不带诊断" },
    });
    fireEvent.click(screen.getByLabelText(/附带诊断信息/));
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledTimes(1);
    });
    const context = mockSubmit.mock.calls[0]![2] as Record<string, unknown>;
    expect(context.lastRunId).toBeUndefined();
    expect(context.lastError).toBeUndefined();
    expect(context.route).toBe("/");
  });

  it("选择分类随提交传递", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/说说遇到的问题或想法/), {
      target: { value: "想要暗色主题" },
    });
    fireEvent.click(screen.getByLabelText("功能建议"));
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledTimes(1);
    });
    expect(mockSubmit.mock.calls[0]![1]).toBe("feature");
  });

  it("提交失败显示错误且不关闭", async () => {
    mockSubmit.mockRejectedValue(new Error("too many submissions"));
    const { onClose } = renderModal();
    fireEvent.change(screen.getByLabelText(/说说遇到的问题或想法/), {
      target: { value: "会失败的提交" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(screen.getByText("too many submissions")).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
    // 表单内容保留，可重试
    expect((screen.getByLabelText(/说说遇到的问题或想法/) as HTMLTextAreaElement).value).toBe(
      "会失败的提交",
    );
  });

  it("按 Escape 关闭", () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("粘贴图片显示预览并可移除", async () => {
    renderModal();
    const file = new File(["x".repeat(100)], "shot.png", { type: "image/png" });
    fireEvent.paste(window, {
      clipboardData: { items: [{ type: "image/png", getAsFile: () => file }] },
    });
    await waitFor(() => {
      expect(screen.getByAltText("反馈截图")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "移除截图" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除截图" }));
    await waitFor(() => {
      expect(screen.queryByAltText("反馈截图")).not.toBeInTheDocument();
    });
  });

  it("粘贴超大图片显示错误且不附加", async () => {
    renderModal();
    const big = new File(["x".repeat(1_000_001)], "big.png", { type: "image/png" });
    fireEvent.paste(window, {
      clipboardData: { items: [{ type: "image/png", getAsFile: () => big }] },
    });
    await waitFor(() => {
      expect(screen.getByText("截图超过 1MB，请裁剪后重试")).toBeInTheDocument();
    });
    expect(screen.queryByAltText("反馈截图")).not.toBeInTheDocument();
  });

  it("粘贴非图片内容不响应", () => {
    renderModal();
    fireEvent.paste(window, {
      clipboardData: { items: [{ type: "text/plain", getAsFile: () => null }] },
    });
    expect(screen.queryByAltText("反馈截图")).not.toBeInTheDocument();
    expect(screen.queryByText(/超过 1MB/)).not.toBeInTheDocument();
  });
});
