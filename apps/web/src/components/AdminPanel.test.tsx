import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import AdminPanel from "./AdminPanel";
import { api, type AdminUser, type AuditItem } from "../lib/api";

// Mock api
vi.mock("../lib/api", () => ({
  api: {
    adminListUsers: vi.fn(),
    adminSetUserRole: vi.fn(),
    listAudit: vi.fn(),
  },
}));

// Mock Tooltip
vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

// Mock ConfirmDialog — expose title/description/danger and a confirm button
vi.mock("./ConfirmDialog", () => ({
  default: ({
    open,
    title,
    description,
    confirmLabel,
    danger,
    onConfirm,
    onCancel,
  }: any) =>
    open ? (
      <div data-testid="confirm-dialog" data-danger={danger ? "true" : "false"}>
        <span>{title}</span>
        <p>{description}</p>
        <button onClick={onConfirm}>{confirmLabel}</button>
        <button onClick={onCancel}>cancel</button>
      </div>
    ) : null,
}));

const mockAdminListUsers = api.adminListUsers as unknown as ReturnType<typeof vi.fn>;
const mockAdminSetUserRole = api.adminSetUserRole as unknown as ReturnType<typeof vi.fn>;
const mockListAudit = api.listAudit as unknown as ReturnType<typeof vi.fn>;

const OWNER: AdminUser = {
  id: "u-owner",
  email: "owner@test.dev",
  role: "owner",
  createdAt: "2026-01-01T00:00:00Z",
};
const ADMIN: AdminUser = {
  id: "u-admin",
  email: "admin@test.dev",
  role: "admin",
  createdAt: "2026-02-01T00:00:00Z",
};
const USER: AdminUser = {
  id: "u-user",
  email: "user@test.dev",
  role: "user",
  createdAt: "2026-03-01T00:00:00Z",
};

const BASE_TS = 1_000_000_000_000;

const auditItem = (i: number, over: Partial<AuditItem> = {}): AuditItem => ({
  id: `a-${i}`,
  user_id: "u-user",
  email: "user@test.dev",
  action: "account.login",
  object_type: null,
  object_id: null,
  detail: null,
  ip: "127.0.0.1",
  created_at: BASE_TS + i,
  ...over,
});

const OWNER_ME = { id: "u-owner", email: "owner@test.dev", role: "owner" };
const ADMIN_ME = { id: "u-admin", email: "admin@test.dev", role: "admin" };

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminListUsers.mockResolvedValue({ users: [OWNER, ADMIN, USER] });
  mockListAudit.mockResolvedValue({ items: [auditItem(0), auditItem(1)] });
});

describe("AdminPanel", () => {
  describe("owner 视图", () => {
    it("渲染用户和审计双 tab，默认选中用户", async () => {
      render(<AdminPanel open me={OWNER_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("owner@test.dev")).toBeInTheDocument();
      });
      const usersTab = screen.getByRole("button", { name: "用户" });
      const auditTab = screen.getByRole("button", { name: "审计日志" });
      expect(usersTab).toBeInTheDocument();
      expect(auditTab).toBeInTheDocument();
      expect(usersTab.className).toContain("is-on");
      expect(auditTab.className).not.toContain("is-on");
    });

    it("owner 行无操作按钮，admin 行有撤回，user 行有授予", async () => {
      render(<AdminPanel open me={OWNER_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("owner@test.dev")).toBeInTheDocument();
      });
      expect(screen.getAllByText("撤回管理员")).toHaveLength(1);
      expect(screen.getAllByText("设为管理员")).toHaveLength(1);
    });

    it("授予确认非 danger，撤回确认为 danger", async () => {
      render(<AdminPanel open me={OWNER_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("user@test.dev")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("设为管理员"));
      expect(screen.getByTestId("confirm-dialog")).toHaveAttribute("data-danger", "false");
      fireEvent.click(within(screen.getByTestId("confirm-dialog")).getByText("cancel"));
      fireEvent.click(screen.getByText("撤回管理员"));
      expect(screen.getByTestId("confirm-dialog")).toHaveAttribute("data-danger", "true");
    });

    it("确认授予后调用 API 并重载列表", async () => {
      render(<AdminPanel open me={OWNER_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("user@test.dev")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("设为管理员"));
      fireEvent.click(within(screen.getByTestId("confirm-dialog")).getByText("设为管理员"));
      await waitFor(() => {
        expect(mockAdminSetUserRole).toHaveBeenCalledWith("u-user", "admin");
      });
      await waitFor(() => {
        expect(mockAdminListUsers).toHaveBeenCalledTimes(2);
      });
      expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    });

    it("确认撤回后以 user 角色调用 API", async () => {
      render(<AdminPanel open me={OWNER_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("admin@test.dev")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("撤回管理员"));
      fireEvent.click(within(screen.getByTestId("confirm-dialog")).getByText("撤回管理员"));
      await waitFor(() => {
        expect(mockAdminSetUserRole).toHaveBeenCalledWith("u-admin", "user");
      });
    });

    it("角色更新失败渲染错误提示", async () => {
      mockAdminSetUserRole.mockRejectedValue(new Error("boom"));
      render(<AdminPanel open me={OWNER_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("user@test.dev")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("设为管理员"));
      fireEvent.click(within(screen.getByTestId("confirm-dialog")).getByText("设为管理员"));
      await waitFor(() => {
        expect(screen.getByText("角色更新失败")).toBeInTheDocument();
      });
    });

    it("用户列表加载失败渲染错误提示", async () => {
      mockAdminListUsers.mockRejectedValue(new Error("boom"));
      render(<AdminPanel open me={OWNER_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("用户列表加载失败")).toBeInTheDocument();
      });
    });

    it("空用户列表显示空态", async () => {
      mockAdminListUsers.mockResolvedValue({ users: [] });
      render(<AdminPanel open me={OWNER_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("暂无用户")).toBeInTheDocument();
      });
    });
  });

  describe("admin 视图", () => {
    it("仅显示审计 tab，不请求用户列表", async () => {
      render(<AdminPanel open me={ADMIN_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getAllByText("account.login").length).toBeGreaterThan(0);
      });
      expect(screen.queryByRole("button", { name: "用户" })).not.toBeInTheDocument();
      expect(mockAdminListUsers).not.toHaveBeenCalled();
    });

    it("渲染审计行：时间、email、action、ip；未知用户兜底", async () => {
      mockListAudit.mockResolvedValue({
        items: [
          auditItem(0),
          auditItem(1, { email: null, detail: '{"grantee":"u-user","role":"admin"}' }),
        ],
      });
      render(<AdminPanel open me={ADMIN_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getAllByText("account.login")).toHaveLength(2);
      });
      expect(screen.getByText("user@test.dev")).toBeInTheDocument();
      expect(screen.getByText("未知用户")).toBeInTheDocument();
      expect(screen.getByText('{"grantee":"u-user","role":"admin"}')).toBeInTheDocument();
      expect(screen.getAllByText("127.0.0.1")).toHaveLength(2);
    });

    it("审计加载失败渲染错误提示", async () => {
      mockListAudit.mockRejectedValue(new Error("boom"));
      render(<AdminPanel open me={ADMIN_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("审计日志加载失败")).toBeInTheDocument();
      });
    });

    it("空审计显示空态", async () => {
      mockListAudit.mockResolvedValue({ items: [] });
      render(<AdminPanel open me={ADMIN_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("暂无审计记录")).toBeInTheDocument();
      });
    });
  });

  describe("审计分页", () => {
    it("满页显示'加载更多'，点击后带 before 游标请求", async () => {
      const full = Array.from({ length: 50 }, (_, i) => auditItem(i));
      mockListAudit.mockResolvedValueOnce({ items: full });
      render(<AdminPanel open me={ADMIN_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("加载更多")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("加载更多"));
      await waitFor(() => {
        expect(mockListAudit).toHaveBeenLastCalledWith({
          limit: 50,
          before: BASE_TS + 49,
        });
      });
    });

    it("不满页显示'没有更多了'", async () => {
      render(<AdminPanel open me={ADMIN_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("没有更多了")).toBeInTheDocument();
      });
      expect(screen.queryByText("加载更多")).not.toBeInTheDocument();
    });
  });

  describe("关闭行为", () => {
    it("点击 backdrop 关闭", async () => {
      const onClose = vi.fn();
      render(<AdminPanel open me={ADMIN_ME} onClose={onClose} />);
      await waitFor(() => {
        expect(screen.getAllByText("account.login").length).toBeGreaterThan(0);
      });
      fireEvent.click(document.querySelector(".modal-backdrop")!);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("按 Escape 关闭", async () => {
      const onClose = vi.fn();
      render(<AdminPanel open me={ADMIN_ME} onClose={onClose} />);
      await waitFor(() => {
        expect(screen.getAllByText("account.login").length).toBeGreaterThan(0);
      });
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("open=false 时不渲染", () => {
      const { container } = render(<AdminPanel open={false} me={ADMIN_ME} onClose={() => {}} />);
      expect(container.firstChild).toBeNull();
    });
  });
});
