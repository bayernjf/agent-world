import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import VersionPanel from "./VersionPanel";

// Mock TemplatePreview from TemplatePicker
vi.mock("./TemplatePicker", () => ({
  TemplatePreview: ({ nodes, edges }: { nodes: unknown[]; edges: unknown[] }) => (
    <div data-testid="template-preview">
      <span>{nodes.length} nodes</span>
      <span>{edges.length} edges</span>
    </div>
  ),
}));

const sampleVersions = [
  {
    id: "v1",
    graphId: "g1",
    name: "版本1",
    note: "初始版本",
    contentHash: "hash1",
    createdAt: Date.now() - 86400000,
  },
  {
    id: "v2",
    graphId: "g1",
    name: "版本2",
    note: "优化了提示词",
    contentHash: "hash2",
    createdAt: Date.now() - 3600000,
  },
];

const sampleSnapshot = {
  name: "版本1",
  snapshot: {
    id: "g1",
    name: "测试产线",
    nodes: [
      { id: "n1", kind: "source", x: 0, y: 0 },
      { id: "n2", kind: "textGen", x: 100, y: 0 },
      { id: "n3", kind: "sink", x: 200, y: 0 },
    ],
    edges: [
      { from: "n1", to: "n2", kind: "forward" },
      { from: "n2", to: "n3", kind: "forward" },
    ],
  },
};

function mockFetch(responses: Record<string, unknown> = {}) {
  const defaultResponses: Record<string, unknown> = {
    "GET /api/graphs/g1/versions": {
      versions: sampleVersions,
      latestRunHash: "hash1",
      currentHash: "hash2",
    },
    "POST /api/graphs/g1/versions": { ok: true },
    "POST /api/graphs/g1/versions/v1/restore": { ok: true },
    "DELETE /api/graphs/g1/versions/v1": { ok: true },
    "GET /api/graphs/g1/versions/v1": sampleSnapshot,
    ...responses,
  };

  return vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    const method = options?.method ?? "GET";
    const key = `${method} ${url}`;
    const response = defaultResponses[key] ?? { ok: true };
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(response),
    });
  });
}

function renderPanel(open = true) {
  const onClose = vi.fn();
  const onRestored = vi.fn();
  render(
    <VersionPanel
      open={open}
      graphId="g1"
      graphName="测试产线"
      onClose={onClose}
      onRestored={onRestored}
    />,
  );
  return { onClose, onRestored };
}

async function renderAndWait(open = true) {
  const result = renderPanel(open);
  if (open) {
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  }
  return result;
}

describe("VersionPanel", () => {
  let originalFetch: typeof global.fetch;
  let originalConfirm: typeof window.confirm;
  let originalAlert: typeof window.alert;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
    originalConfirm = window.confirm;
    originalAlert = window.alert;
    global.fetch = mockFetch() as unknown as typeof global.fetch;
    window.confirm = vi.fn().mockReturnValue(true);
    window.alert = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.confirm = originalConfirm;
    window.alert = originalAlert;
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(
        <VersionPanel open={false} graphId="g1" graphName="测试" onClose={vi.fn()} onRestored={vi.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("open=true 时显示标题'产线版本 — 测试产线'", async () => {
      await renderAndWait();
      expect(screen.getByText("产线版本 — 测试产线")).toBeInTheDocument();
    });

    it("显示关闭按钮", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
    });

    it("显示版本名称输入框", async () => {
      await renderAndWait();
      expect(screen.getByPlaceholderText("版本名称（留空用时间戳）")).toBeInTheDocument();
    });

    it("显示备注输入框", async () => {
      await renderAndWait();
      expect(screen.getByPlaceholderText("备注（可选）")).toBeInTheDocument();
    });

    it("显示'保存当前版本'按钮", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "保存当前版本" })).toBeInTheDocument();
    });

    it("调用 fetch 获取版本列表", async () => {
      await renderAndWait();
      expect(global.fetch).toHaveBeenCalledWith("/api/graphs/g1/versions");
    });
  });

  describe("加载状态", () => {
    it("加载中显示'加载中...'", () => {
      // fetch 不 resolve，保持 loading 状态
      global.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as unknown as typeof global.fetch;
      renderPanel();
      expect(screen.getByText("加载中...")).toBeInTheDocument();
    });

    it("无版本时显示提示", async () => {
      global.fetch = mockFetch({
        "GET /api/graphs/g1/versions": { versions: [], latestRunHash: null, currentHash: "hash" },
      }) as unknown as typeof global.fetch;
      await renderAndWait();
      expect(screen.getByText(/暂无版本/)).toBeInTheDocument();
    });
  });

  describe("版本列表", () => {
    it("显示所有版本名称", async () => {
      await renderAndWait();
      expect(screen.getByText("版本1")).toBeInTheDocument();
      expect(screen.getByText("版本2")).toBeInTheDocument();
    });

    it("显示版本备注", async () => {
      await renderAndWait();
      expect(screen.getByText("初始版本")).toBeInTheDocument();
      expect(screen.getByText("优化了提示词")).toBeInTheDocument();
    });

    it("显示'最近运行'标记（contentHash 匹配 latestRunHash）", async () => {
      await renderAndWait();
      expect(screen.getByText("最近运行")).toBeInTheDocument();
    });

    it("显示'与当前一致'标记（contentHash 匹配 currentHash）", async () => {
      await renderAndWait();
      expect(screen.getByText("与当前一致")).toBeInTheDocument();
    });

    it("每个版本显示预览/恢复/删除按钮", async () => {
      await renderAndWait();
      const previewButtons = screen.getAllByRole("button", { name: "预览" });
      const restoreButtons = screen.getAllByRole("button", { name: "恢复" });
      const deleteButtons = screen.getAllByRole("button", { name: "删除" });
      expect(previewButtons.length).toBe(2);
      expect(restoreButtons.length).toBe(2);
      expect(deleteButtons.length).toBe(2);
    });
  });

  describe("保存版本", () => {
    it("输入名称后点击保存调用 fetch POST", async () => {
      await renderAndWait();
      const nameInput = screen.getByPlaceholderText("版本名称（留空用时间戳）");
      fireEvent.change(nameInput, { target: { value: "新版本" } });
      fireEvent.click(screen.getByRole("button", { name: "保存当前版本" }));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/graphs/g1/versions",
          expect.objectContaining({ method: "POST" }),
        );
      });
    });

    it("保存后清空输入框", async () => {
      await renderAndWait();
      const nameInput = screen.getByPlaceholderText("版本名称（留空用时间戳）");
      fireEvent.change(nameInput, { target: { value: "新版本" } });
      fireEvent.click(screen.getByRole("button", { name: "保存当前版本" }));
      await waitFor(() => {
        expect(nameInput).toHaveValue("");
      });
    });

    it("保存中按钮显示'保存中...'", async () => {
      // fetch POST 不 resolve，保持 saving 状态
      global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          return new Promise(() => {});
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ versions: sampleVersions, latestRunHash: null, currentHash: "hash" }),
        });
      }) as unknown as typeof global.fetch;
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "保存当前版本" }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "保存中..." })).toBeInTheDocument();
      });
    });
  });

  describe("恢复版本", () => {
    it("点击恢复调用 window.confirm", async () => {
      await renderAndWait();
      const restoreButtons = screen.getAllByRole("button", { name: "恢复" });
      fireEvent.click(restoreButtons[0]);
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("确定恢复"));
    });

    it("确认恢复后调用 fetch POST restore", async () => {
      await renderAndWait();
      const restoreButtons = screen.getAllByRole("button", { name: "恢复" });
      fireEvent.click(restoreButtons[0]);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/graphs/g1/versions/v1/restore",
          expect.objectContaining({ method: "POST" }),
        );
      });
    });

    it("恢复成功后调用 onRestored 和 onClose", async () => {
      const { onClose, onRestored } = await renderAndWait();
      const restoreButtons = screen.getAllByRole("button", { name: "恢复" });
      fireEvent.click(restoreButtons[0]);
      await waitFor(() => {
        expect(onRestored).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
      });
    });

    it("取消恢复不调用 fetch", async () => {
      window.confirm = vi.fn().mockReturnValue(false);
      await renderAndWait();
      const restoreButtons = screen.getAllByRole("button", { name: "恢复" });
      fireEvent.click(restoreButtons[0]);
      expect(global.fetch).not.toHaveBeenCalledWith(
        expect.stringContaining("/restore"),
        expect.anything(),
      );
    });
  });

  describe("删除版本", () => {
    it("点击删除调用 window.confirm", async () => {
      await renderAndWait();
      const deleteButtons = screen.getAllByRole("button", { name: "删除" });
      fireEvent.click(deleteButtons[0]);
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("确定删除"));
    });

    it("确认删除后调用 fetch DELETE", async () => {
      await renderAndWait();
      const deleteButtons = screen.getAllByRole("button", { name: "删除" });
      fireEvent.click(deleteButtons[0]);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/graphs/g1/versions/v1",
          expect.objectContaining({ method: "DELETE" }),
        );
      });
    });

    it("取消删除不调用 fetch DELETE", async () => {
      window.confirm = vi.fn().mockReturnValue(false);
      await renderAndWait();
      const deleteButtons = screen.getAllByRole("button", { name: "删除" });
      fireEvent.click(deleteButtons[0]);
      expect(global.fetch).not.toHaveBeenCalledWith(
        expect.stringContaining("/versions/v1"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  describe("预览版本", () => {
    it("点击预览调用 fetch 获取版本详情", async () => {
      await renderAndWait();
      const previewButtons = screen.getAllByRole("button", { name: "预览" });
      fireEvent.click(previewButtons[0]);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/graphs/g1/versions/v1");
      });
    });

    it("预览加载后显示预览覆盖层", async () => {
      await renderAndWait();
      const previewButtons = screen.getAllByRole("button", { name: "预览" });
      fireEvent.click(previewButtons[0]);
      await waitFor(() => {
        expect(screen.getByTestId("template-preview")).toBeInTheDocument();
      });
    });

    it("预览显示版本名称", async () => {
      await renderAndWait();
      const previewButtons = screen.getAllByRole("button", { name: "预览" });
      fireEvent.click(previewButtons[0]);
      await waitFor(() => {
        expect(screen.getByText("版本1")).toBeInTheDocument();
      });
    });

    it("预览显示节点和连线数量摘要", async () => {
      await renderAndWait();
      const previewButtons = screen.getAllByRole("button", { name: "预览" });
      fireEvent.click(previewButtons[0]);
      await waitFor(() => {
        expect(screen.getByText(/3 个节点 · 2 条连线/)).toBeInTheDocument();
      });
    });

    it("点击预览关闭按钮关闭预览", async () => {
      await renderAndWait();
      const previewButtons = screen.getAllByRole("button", { name: "预览" });
      fireEvent.click(previewButtons[0]);
      await waitFor(() => {
        expect(screen.getByTestId("template-preview")).toBeInTheDocument();
      });
      // 预览覆盖层有两个"关闭"按钮（主面板 + 预览），点击预览的关闭
      const closeButtons = screen.getAllByRole("button", { name: "关闭" });
      fireEvent.click(closeButtons[closeButtons.length - 1]);
      await waitFor(() => {
        expect(screen.queryByTestId("template-preview")).not.toBeInTheDocument();
      });
    });
  });

  describe("关闭", () => {
    it("点击关闭按钮调用 onClose", async () => {
      const { onClose } = await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "关闭" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击背景调用 onClose", async () => {
      const { onClose } = await renderAndWait();
      const overlay = document.querySelector(".modal-overlay")!;
      fireEvent.click(overlay);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击模态框内容不调用 onClose", async () => {
      const { onClose } = await renderAndWait();
      const modal = document.querySelector(".modal")!;
      fireEvent.click(modal);
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
