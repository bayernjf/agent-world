import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
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

function renderPanel(overrides: {
  servers?: UserMcpServer[];
  statuses?: Record<string, McpServerStatus>;
  onSaveAndConnect?: (id: string) => Promise<McpServerStatus>;
} = {}) {
  const onChange = vi.fn();
  const success: McpServerStatus = {
    id: "s1",
    transport: "http",
    url: s1.url,
    connected: true,
    toolCount: 2,
    toolNames: ["echo", "search"],
  };
  const onSaveAndConnect = overrides.onSaveAndConnect ?? vi.fn().mockResolvedValue(success);
  const props = {
    servers: overrides.servers ?? [s1],
    onChange,
    onSaveAndConnect,
    statuses: overrides.statuses ?? {},
  };
  const { rerender } = render(<McpSettings {...props} />);
  // The panel reports the result upward; the parent stores it and rerenders.
  const simulateParent = (status: McpServerStatus) =>
    rerender(<McpSettings {...props} statuses={{ ...props.statuses, [status.id]: status }} />);
  return { onChange, onSaveAndConnect, success, simulateParent };
}

describe("McpSettings", () => {
  it("shows the empty hint when nothing is configured", () => {
    renderPanel({ servers: [] });
    expect(screen.getByText(/还没有 MCP 服务/)).toBeInTheDocument();
  });

  it("only offers http and sse transports — no stdio option", () => {
    renderPanel();
    const options = [...document.querySelectorAll("select option")].map((o) => o.textContent);
    expect(options).toContain("HTTP（Streamable）");
    expect(options).toContain("SSE");
    expect(options.join(" ")).not.toContain("stdio");
  });

  it("adds a new server from the name input", () => {
    const { onChange } = renderPanel({ servers: [] });
    fireEvent.change(screen.getByPlaceholderText(/新服务名称/), { target: { value: "我的仓库" } });
    fireEvent.click(screen.getByText("添加"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const added = onChange.mock.calls[0][0][0] as UserMcpServer;
    expect(added.id).toBe("mcp-1");
    expect(added.transport).toBe("http");
  });

  it("save-and-connect hands off the id and shows the discovered tools", async () => {
    const { onSaveAndConnect, success, simulateParent } = renderPanel();
    fireEvent.click(screen.getByText("保存并试连"));
    await waitFor(() => expect(onSaveAndConnect).toHaveBeenCalledWith("s1"));
    simulateParent(success);
    expect(screen.getByTestId("mcp-status-s1").textContent).toContain("echo, search");
  });

  it("renders a failed handshake as an error line", () => {
    renderPanel({
      statuses: {
        s1: { id: "s1", transport: "http", url: s1.url, connected: false, toolCount: 0, toolNames: [], error: "ECONNREFUSED" },
      },
    });
    const line = screen.getByTestId("mcp-status-s1");
    expect(line.className).toContain("mcp-bad");
    expect(line.textContent).toContain("ECONNREFUSED");
  });

  it("disables the connect button while the endpoint is empty", () => {
    renderPanel({ servers: [{ ...s1, url: "" }] });
    expect(screen.getByText("保存并试连")).toBeDisabled();
  });
});
