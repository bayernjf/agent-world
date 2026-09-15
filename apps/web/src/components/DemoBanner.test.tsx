import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import DemoBanner from "./DemoBanner";
import { useSession, type SessionUser } from "../store/session";

const mockLogout = vi.fn();
vi.mock("./AuthPages", () => ({
  logout: () => mockLogout(),
}));

const demoUser = (): SessionUser => ({
  id: "d1",
  email: "demo+abcd1234@demo.local",
  isDemo: true,
  demo: {
    expiresAt: "2026-09-16T10:00:00.000Z",
    quota: { tokens: 30000, maxRunsTotal: 15, concurrentRuns: 1, storageBytes: 20_000_000, videoSegments: 0 },
  },
});

describe("DemoBanner", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSession.setState({ user: null });
    delete (window as any).location;
    (window as any).location = { assign: vi.fn() };
  });
  afterEach(() => useSession.setState({ user: null }));

  it("无 session 时不渲染", () => {
    const { container } = render(<DemoBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("正式账号不渲染", () => {
    useSession.setState({ user: { id: "u", email: "a@b.c", isDemo: false } });
    const { container } = render(<DemoBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("演示账号显示演示模式与运行上限", () => {
    useSession.setState({ user: demoUser() });
    render(<DemoBanner />);
    expect(screen.getByText("演示模式")).toBeInTheDocument();
    expect(screen.getByText(/含 15 次运行/)).toBeInTheDocument();
  });

  it("点击注册转正打开全局 claim", () => {
    useSession.setState({ user: demoUser() });
    render(<DemoBanner />);
    fireEvent.click(screen.getByRole("button", { name: "注册并保留我的工作" }));
    expect(useSession.getState().claimOpen).toBe(true);
  });

  it("点击退出演示调用 logout 并回登录页", async () => {
    mockLogout.mockResolvedValue(undefined);
    useSession.setState({ user: demoUser() });
    render(<DemoBanner />);
    fireEvent.click(screen.getByRole("button", { name: "退出演示" }));
    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalledTimes(1);
      expect((window as any).location.assign).toHaveBeenCalledWith("/login");
    });
  });
});
