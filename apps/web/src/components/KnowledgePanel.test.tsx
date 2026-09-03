import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import KnowledgePanel from "./KnowledgePanel";

const sampleEntries = [
  {
    id: "k1",
    title: "产品卖点提炼",
    content: "这是一条关于产品卖点提炼的知识内容，包含多个要点和方法论。",
    source: "manual",
    tags: ["营销", "文案"],
    created_at: 1700000000000,
  },
  {
    id: "k2",
    title: "小红书爆款标题公式",
    content: "数字+痛点+解决方案=爆款标题。例如：3个技巧让你的笔记点赞破万。",
    source: "graph",
    tags: ["小红书", "标题"],
    created_at: 1700100000000,
  },
];

function setupFetch(entries = sampleEntries, total = 2) {
  const mockFetch = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes("/api/knowledge/search")) {
      return {
        ok: true,
        json: async () => ({ entries: [entries[0]], total: 1 }),
      };
    }
    if (options?.method === "POST") {
      return { ok: true, json: async () => ({ id: "k3" }) };
    }
    if (options?.method === "DELETE") {
      return { ok: true, json: async () => ({}) };
    }
    return {
      ok: true,
      json: async () => ({ entries, total }),
    };
  });
  global.fetch = mockFetch as unknown as typeof fetch;
  return mockFetch;
}

function renderPanel(open = true) {
  const onClose = vi.fn();
  render(<KnowledgePanel open={open} onClose={onClose} />);
  return { onClose };
}

async function renderAndWait(open = true) {
  const result = renderPanel(open);
  if (open) {
    await waitFor(() => {
      expect(screen.getByText("知识库 / 档案室")).toBeInTheDocument();
    });
    // 等待 fetch 调用完成（通过检查计数或空状态）
    await waitFor(() => {
      const count = screen.getByText(/共 \d+ 条知识/);
      expect(count).toBeInTheDocument();
    });
  }
  return result;
}

describe("KnowledgePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFetch();
    window.confirm = vi.fn(() => true);
    window.alert = vi.fn();
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(<KnowledgePanel open={false} onClose={vi.fn()} />);
      expect(container.firstChild).toBeNull();
    });

    it("open=true 时显示标题'知识库 / 档案室'", async () => {
      await renderAndWait();
      expect(screen.getByText("知识库 / 档案室")).toBeInTheDocument();
    });

    it("显示关闭按钮", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
    });

    it("显示搜索输入框", async () => {
      await renderAndWait();
      expect(screen.getByPlaceholderText("搜索知识...")).toBeInTheDocument();
    });

    it("显示搜索按钮", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "搜索" })).toBeInTheDocument();
    });

    it("显示重置按钮", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "重置" })).toBeInTheDocument();
    });

    it("显示添加按钮", async () => {
      await renderAndWait();
      expect(screen.getByRole("button", { name: "+ 添加" })).toBeInTheDocument();
    });

    it("调用 fetch 加载知识列表", async () => {
      const mockFetch = setupFetch();
      await renderAndWait();
      expect(mockFetch).toHaveBeenCalledWith("/api/knowledge?limit=100");
    });
  });

  describe("知识列表", () => {
    it("显示知识条目标题", async () => {
      await renderAndWait();
      expect(screen.getByText("产品卖点提炼")).toBeInTheDocument();
      expect(screen.getByText("小红书爆款标题公式")).toBeInTheDocument();
    });

    it("显示知识条目内容", async () => {
      await renderAndWait();
      expect(screen.getByText(/这是一条关于产品卖点提炼的知识内容/)).toBeInTheDocument();
      expect(screen.getByText(/数字\+痛点\+解决方案/)).toBeInTheDocument();
    });

    it("显示知识条目来源", async () => {
      await renderAndWait();
      expect(screen.getByText("来源: manual")).toBeInTheDocument();
      expect(screen.getByText("来源: graph")).toBeInTheDocument();
    });

    it("显示知识条目标签", async () => {
      await renderAndWait();
      expect(screen.getByText("标签: 营销, 文案")).toBeInTheDocument();
      expect(screen.getByText("标签: 小红书, 标题")).toBeInTheDocument();
    });

    it("显示每个条目的删除按钮", async () => {
      await renderAndWait();
      const deleteButtons = screen.getAllByRole("button", { name: "删除" });
      expect(deleteButtons.length).toBe(2);
    });

    it("显示知识总数", async () => {
      await renderAndWait();
      expect(screen.getByText("共 2 条知识")).toBeInTheDocument();
    });
  });

  describe("空状态", () => {
    it("知识库为空时显示空状态提示", async () => {
      setupFetch([], 0);
      await renderAndWait();
      expect(screen.getByText(/知识库为空/)).toBeInTheDocument();
    });

    it("搜索无结果时显示'没有匹配的知识。'", async () => {
      const mockFetch = vi.fn(async (url: string) => {
        if (url.includes("/api/knowledge/search")) {
          return { ok: true, json: async () => ({ entries: [], total: 0 }) };
        }
        return { ok: true, json: async () => ({ entries: sampleEntries, total: 2 }) };
      });
      global.fetch = mockFetch as unknown as typeof fetch;
      await renderAndWait();
      const input = screen.getByPlaceholderText("搜索知识...");
      fireEvent.change(input, { target: { value: "不存在的关键词" } });
      fireEvent.click(screen.getByRole("button", { name: "搜索" }));
      await waitFor(() => {
        expect(screen.getByText("没有匹配的知识。")).toBeInTheDocument();
      });
    });
  });

  describe("搜索", () => {
    it("点击搜索按钮调用搜索 API", async () => {
      const mockFetch = setupFetch();
      await renderAndWait();
      const input = screen.getByPlaceholderText("搜索知识...");
      fireEvent.change(input, { target: { value: "产品" } });
      fireEvent.click(screen.getByRole("button", { name: "搜索" }));
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/knowledge/search?q="),
        );
      });
    });

    it("按 Enter 键触发搜索", async () => {
      const mockFetch = setupFetch();
      await renderAndWait();
      const input = screen.getByPlaceholderText("搜索知识...");
      fireEvent.change(input, { target: { value: "产品" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("/api/knowledge/search?q="),
        );
      });
    });

    it("搜索中按钮显示'搜索中...'", async () => {
      await renderAndWait();
      const input = screen.getByPlaceholderText("搜索知识...");
      fireEvent.change(input, { target: { value: "产品" } });
      fireEvent.click(screen.getByRole("button", { name: "搜索" }));
      expect(screen.getByRole("button", { name: "搜索中..." })).toBeInTheDocument();
    });

    it("搜索结果显示搜索结果计数", async () => {
      await renderAndWait();
      const input = screen.getByPlaceholderText("搜索知识...");
      fireEvent.change(input, { target: { value: "产品" } });
      fireEvent.click(screen.getByRole("button", { name: "搜索" }));
      await waitFor(() => {
        expect(screen.getByText(/搜索结果/)).toBeInTheDocument();
      });
    });

    it("空搜索词点击搜索重新加载全部", async () => {
      const mockFetch = setupFetch();
      await renderAndWait();
      const input = screen.getByPlaceholderText("搜索知识...");
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "搜索" }));
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/knowledge?limit=100");
      });
    });

    it("点击重置按钮清空搜索并重新加载", async () => {
      const mockFetch = setupFetch();
      await renderAndWait();
      const input = screen.getByPlaceholderText("搜索知识...");
      fireEvent.change(input, { target: { value: "产品" } });
      fireEvent.click(screen.getByRole("button", { name: "重置" }));
      expect(input).toHaveValue("");
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/knowledge?limit=100");
      });
    });
  });

  describe("添加知识", () => {
    it("点击添加按钮显示添加表单", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "+ 添加" }));
      expect(screen.getByPlaceholderText("标题")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("内容")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("标签（逗号分隔）")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    });

    it("添加按钮切换为'取消'", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "+ 添加" }));
      expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    });

    it("点击取消隐藏添加表单", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "+ 添加" }));
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      expect(screen.queryByPlaceholderText("标题")).not.toBeInTheDocument();
    });

    it("填写表单并保存调用 POST API", async () => {
      const mockFetch = setupFetch();
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "+ 添加" }));
      fireEvent.change(screen.getByPlaceholderText("标题"), { target: { value: "新知识" } });
      fireEvent.change(screen.getByPlaceholderText("内容"), { target: { value: "新知识内容" } });
      fireEvent.change(screen.getByPlaceholderText("标签（逗号分隔）"), { target: { value: "标签1, 标签2" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/knowledge",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              title: "新知识",
              content: "新知识内容",
              source: "manual",
              tags: ["标签1", "标签2"],
            }),
          }),
        );
      });
    });

    it("保存成功后清空表单并隐藏", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "+ 添加" }));
      fireEvent.change(screen.getByPlaceholderText("标题"), { target: { value: "新知识" } });
      fireEvent.change(screen.getByPlaceholderText("内容"), { target: { value: "新知识内容" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() => {
        expect(screen.queryByPlaceholderText("标题")).not.toBeInTheDocument();
      });
    });

    it("空标题不调用保存", async () => {
      await renderAndWait();
      fireEvent.click(screen.getByRole("button", { name: "+ 添加" }));
      fireEvent.change(screen.getByPlaceholderText("内容"), { target: { value: "有内容但没标题" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(global.fetch).not.toHaveBeenCalledWith(
        "/api/knowledge",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("删除知识", () => {
    it("点击删除按钮调用 confirm", async () => {
      await renderAndWait();
      const deleteButtons = screen.getAllByRole("button", { name: "删除" });
      fireEvent.click(deleteButtons[0]);
      expect(window.confirm).toHaveBeenCalledWith("确定删除这条知识吗？");
    });

    it("确认删除后调用 DELETE API", async () => {
      const mockFetch = setupFetch();
      await renderAndWait();
      const deleteButtons = screen.getAllByRole("button", { name: "删除" });
      fireEvent.click(deleteButtons[0]);
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/knowledge/k1",
          expect.objectContaining({ method: "DELETE" }),
        );
      });
    });

    it("取消删除不调用 DELETE API", async () => {
      const mockFetch = setupFetch();
      (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
      await renderAndWait();
      const deleteButtons = screen.getAllByRole("button", { name: "删除" });
      fireEvent.click(deleteButtons[0]);
      expect(mockFetch).not.toHaveBeenCalledWith(
        "/api/knowledge/k1",
        expect.objectContaining({ method: "DELETE" }),
      );
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

    it("点击面板内容不调用 onClose", async () => {
      const { onClose } = await renderAndWait();
      const panel = document.querySelector(".knowledge-panel")!;
      fireEvent.click(panel);
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
