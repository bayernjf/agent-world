import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import UserMenu from "./UserMenu";
import { useSession, type SessionUser } from "../store/session";

// Mock Tooltip
vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

// Mock AccountDialog
vi.mock("./AccountDialog", () => ({
  default: ({ open, me }: any) =>
    open ? <div data-testid="account-dialog" data-email={me?.email ?? ""}>账户对话框</div> : null,
}));

// Mock logout
const mockLogout = vi.fn();
vi.mock("./AuthPages", () => ({
  logout: () => mockLogout(),
}));

// Mock AdminPanel
vi.mock("./AdminPanel", () => ({
  default: ({ open, me }: any) =>
    open ? <div data-testid="admin-panel" data-role={me?.role ?? ""} /> : null,
}));

// Mock FeedbackModal
vi.mock("./FeedbackModal", () => ({
  default: ({ open }: any) => (open ? <div data-testid="feedback-modal" /> : null),
}));

// Neutralize the remaining HUD controls so the menu test stays isolated.
vi.mock("./GuidedToursMenu", () => ({ default: () => null }));
vi.mock("./LanguageSwitcher", () => ({ default: () => null }));
vi.mock("./ThemeSwitcher", () => ({ default: () => null }));

function setUser(user: SessionUser | null) {
  useSession.setState({ user });
}
const realUser = (over: Partial<SessionUser> = {}): SessionUser => ({
  id: "user-1",
  email: "test@example.com",
  ...over,
});

describe("UserMenu", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSession.setState({ user: null, claimOpen: false });
    delete (window as any).location;
    (window as any).location = { assign: vi.fn() };
  });

  afterEach(() => {
    useSession.setState({ user: null });
  });

  it("无 session 时显示'·'头像", () => {
    render(<UserMenu />);
    expect(screen.getByText("·")).toBeInTheDocument();
  });

  describe("正式账号", () => {
    beforeEach(() => setUser(realUser()));

    it("显示邮箱首字母头像", () => {
      render(<UserMenu />);
      expect(screen.getByText("T")).toBeInTheDocument();
    });

    it("展开菜单显示个人中心与退出登录", () => {
      render(<UserMenu />);
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(screen.getByText("个人中心")).toBeInTheDocument();
      expect(screen.getByText("退出登录")).toBeInTheDocument();
    });

    it("点击个人中心打开 AccountDialog", () => {
      render(<UserMenu />);
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      fireEvent.click(screen.getByText("个人中心"));
      expect(screen.getByTestId("account-dialog")).toHaveAttribute("data-email", "test@example.com");
    });

    it("点击退出登录调用 logout 并回登录页", async () => {
      mockLogout.mockResolvedValue(undefined);
      render(<UserMenu />);
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      fireEvent.click(screen.getByText("退出登录"));
      expect(mockLogout).toHaveBeenCalledTimes(1);
    });

    it("owner 显示管理入口、普通用户不显示", () => {
      setUser(realUser({ role: "owner" }));
      render(<UserMenu />);
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(screen.getByText("管理")).toBeInTheDocument();
      cleanup();
      setUser(realUser({ role: "user" }));
      render(<UserMenu />);
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(screen.queryByText("管理")).not.toBeInTheDocument();
    });

    it("正式账号不显示转正/退出演示项", () => {
      render(<UserMenu />);
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(screen.queryByText("注册转正（保留数据）")).not.toBeInTheDocument();
      expect(screen.queryByText("退出演示")).not.toBeInTheDocument();
    });
  });

  describe("演示账号", () => {
    beforeEach(() => setUser(realUser({ isDemo: true, role: "user" })));

    it("隐藏个人中心（改密）", () => {
      render(<UserMenu />);
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(screen.queryByText("个人中心")).not.toBeInTheDocument();
    });

    it("显示注册转正与退出演示", () => {
      render(<UserMenu />);
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(screen.getByText("注册转正（保留数据）")).toBeInTheDocument();
      expect(screen.getByText("退出演示")).toBeInTheDocument();
    });

    it("演示账号即使带 admin role 也不显示管理入口", () => {
      setUser(realUser({ isDemo: true, role: "admin" }));
      render(<UserMenu />);
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(screen.queryByText("管理")).not.toBeInTheDocument();
    });

    it("点击注册转正打开全局 claim 状态", () => {
      render(<UserMenu />);
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      fireEvent.click(screen.getByText("注册转正（保留数据）"));
      expect(useSession.getState().claimOpen).toBe(true);
    });
  });
});
