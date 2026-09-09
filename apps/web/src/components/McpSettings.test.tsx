import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { McpSettings } from "./McpSettings";
import type { McpServerStatus, UserMcpServer } from "../lib/api";

beforeEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const s1: UserMcpServer = {
  id: "s1",
  name: "Example",
  transport: "http",
  url: "https://example.com/mcp",
  enabled: true,
};

const success: McpServerStatus = {
  id: "s1",
  transport: "http",
  url: s1.url,
  connected: true,
  toolCount: 2,
  toolNames: ["echo", "search"],
};

function renderPanel(overrides: {
  servers?: UserMcpServer[];
  statuses?: Record<string, McpServerStatus>;
  onSaveAndConnect?: (id: string) => Promise<McpServerStatus>;
} = {}) {
  const onChange = vi.fn();
  const onSaveAndConnect = overrides.onSaveAndConnect ?? vi.fn().mockResolvedValue(success);
  const props = {
    servers: overrides.servers ?? [s1],
    onChange,
    onSaveAndConnect,
    statuses: overrides.statuses ?? {},
  };
  const { rerender } = render(<McpSettings {...props} />);
  const openCard = (id: string) => {
    const card = document.querySelector(`[data-testid="mcp-server-${id}"] .model-card__head`) as HTMLElement;
    fireEvent.click(card);
  };
  const simulateParent = (status: McpServerStatus) =>
    rerender(<McpSettings {...props} statuses={{ ...props.statuses, [status.id]: status }} />);
  return { onChange, onSaveAndConnect, success, openCard, simulateParent };
}

describe("McpSettings", () => {
  it("shows the empty hint when nothing is configured", () => {
    renderPanel({ servers: [] });
    expect(screen.getByText(/还没有 MCP 服务/)).toBeInTheDocument();
  });

  it("only offers http and sse transports — no stdio option", () => {
    const { openCard } = renderPanel();
    openCard("s1");
    const options = [...document.querySelectorAll("select option")].map((o) => o.textContent);
    expect(options).toContain("HTTP（Streamable）");
    expect(options).toContain("SSE");
    expect(options.join(" ")).not.toContain("stdio");
  });

  it("adds a new server from the name input and expands it", () => {
    const { onChange } = renderPanel({ servers: [] });
    fireEvent.change(screen.getByPlaceholderText(/新服务名称/), { target: { value: "我的仓库" } });
    fireEvent.click(screen.getByText("添加"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const added = onChange.mock.calls[0][0][0] as UserMcpServer;
    expect(added.id).toBe("mcp-1");
    expect(added.name).toBe("我的仓库");
    expect(added.transport).toBe("http");
  });

  it("save-and-connect hands off the id and shows the discovered tools", async () => {
    const { onSaveAndConnect, openCard, simulateParent } = renderPanel();
    openCard("s1");
    fireEvent.click(screen.getByText("保存并试连"));
    await waitFor(() => expect(onSaveAndConnect).toHaveBeenCalledWith("s1"));
    simulateParent(success);
    expect(screen.getByTestId("mcp-status-s1").textContent).toContain("echo, search");
  });

  it("renders a failed handshake as an error diag", () => {
    const { openCard } = renderPanel({
      statuses: {
        s1: { id: "s1", transport: "http", url: s1.url, connected: false, toolCount: 0, toolNames: [], error: "ECONNREFUSED" },
      },
    });
    openCard("s1");
    const line = screen.getByTestId("mcp-status-s1");
    expect(line.className).toContain("diag--error");
    expect(line.textContent).toContain("ECONNREFUSED");
  });

  it("disables the connect button while the endpoint is empty", () => {
    const { openCard } = renderPanel({ servers: [{ ...s1, url: "" }] });
    openCard("s1");
    expect(screen.getByText("保存并试连")).toBeDisabled();
  });

  it("removes a server from its collapsed head", () => {
    const { onChange } = renderPanel();
    fireEvent.click(within(document.querySelector('[data-testid="mcp-server-s1"]')!).getByText("删除"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  describe("搜索", () => {
    const s2: UserMcpServer = {
      id: "github",
      name: "GitHub",
      transport: "sse",
      url: "https://github.test/sse",
      enabled: true,
    };
    const two = [s1, s2];

    it("没有服务时不显示搜索框", () => {
      renderPanel({ servers: [] });
      expect(screen.queryByPlaceholderText(/按名称、ID 或地址搜索/)).not.toBeInTheDocument();
    });

    it("按名称过滤", () => {
      renderPanel({ servers: two });
      fireEvent.change(screen.getByPlaceholderText(/按名称、ID 或地址搜索/), { target: { value: "github" } });
      expect(screen.queryByTestId("mcp-server-github")).toBeInTheDocument();
      expect(screen.queryByTestId("mcp-server-s1")).not.toBeInTheDocument();
      expect(screen.queryByText(/没有匹配的 MCP 服务/)).not.toBeInTheDocument();
    });

    it("按 URL 或 ID 也能命中", () => {
      renderPanel({ servers: two });
      fireEvent.change(screen.getByPlaceholderText(/按名称、ID 或地址搜索/), { target: { value: "example.com" } });
      expect(screen.queryByTestId("mcp-server-s1")).toBeInTheDocument();
      expect(screen.queryByTestId("mcp-server-github")).not.toBeInTheDocument();
    });

    it("无匹配时给出提示并隐藏列表", () => {
      renderPanel({ servers: two });
      fireEvent.change(screen.getByPlaceholderText(/按名称、ID 或地址搜索/), { target: { value: "不存在" } });
      expect(screen.getByText(/没有匹配的 MCP 服务/)).toBeInTheDocument();
      expect(screen.queryByTestId("mcp-server-s1")).not.toBeInTheDocument();
    });
  });
});
