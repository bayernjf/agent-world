import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import AdminPanel from "./AdminPanel";
import { api, type AdminUser, type AuditItem, type FeedbackItem } from "../lib/api";

// Mock api
vi.mock("../lib/api", () => ({
  api: {
    adminListUsers: vi.fn(),
    adminSetUserRole: vi.fn(),
    listAudit: vi.fn(),
    listFeedback: vi.fn(),
    updateFeedbackStatus: vi.fn(),
    feedbackAttachmentUrl: (id: string) => `/api/feedback/${id}/attachment`,
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
const mockListFeedback = api.listFeedback as unknown as ReturnType<typeof vi.fn>;
const mockUpdateFeedbackStatus = api.updateFeedbackStatus as unknown as ReturnType<typeof vi.fn>;

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

const feedbackItem = (i: number, over: Partial<FeedbackItem> = {}): FeedbackItem => ({
  id: `f-${i}`,
  user_id: "u-user",
  email: "user@test.dev",
  message: `反馈内容 ${i}`,
  category: "bug",
  context: JSON.stringify({ route: "/canvas" }),
  has_attachment: 0,
  status: "open",
  created_at: BASE_TS + i,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminListUsers.mockResolvedValue({ users: [OWNER, ADMIN, USER] });
  mockListAudit.mockResolvedValue({ items: [auditItem(0), auditItem(1)] });
  mockListFeedback.mockResolvedValue({ items: [] });
});

describe("AdminPanel", () => {
  describe("owner 视图", () => {
    it("渲染用户/审计/反馈三个 tab，默认选中用户", async () => {
      render(<AdminPanel open me={OWNER_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getByText("owner@test.dev")).toBeInTheDocument();
      });
      const usersTab = screen.getByRole("button", { name: "用户" });
      const auditTab = screen.getByRole("button", { name: "审计日志" });
      const feedbackTab = screen.getByRole("button", { name: "反馈" });
      expect(usersTab).toBeInTheDocument();
      expect(auditTab).toBeInTheDocument();
      expect(feedbackTab).toBeInTheDocument();
      expect(usersTab.className).toContain("is-on");
      expect(auditTab.className).not.toContain("is-on");
      expect(feedbackTab.className).not.toContain("is-on");
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
    it("显示审计与反馈 tab（无用户 tab），不请求用户列表", async () => {
      render(<AdminPanel open me={ADMIN_ME} onClose={() => {}} />);
      await waitFor(() => {
        expect(screen.getAllByText("account.login").length).toBeGreaterThan(0);
      });
      expect(screen.queryByRole("button", { name: "用户" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "反馈" })).toBeInTheDocument();
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

  describe("反馈 tab", () => {
    async function openFeedbackTab(me = OWNER_ME) {
      render(<AdminPanel open me={me} onClose={() => {}} />);
      const feedbackTab = await screen.findByRole("button", { name: "反馈" });
      fireEvent.click(feedbackTab);
    }

    it("渲染反馈行：email、分类、内容、上下文摘要", async () => {
      mockListFeedback.mockResolvedValue({
        items: [
          feedbackItem(0),
          feedbackItem(1, {
            email: null,
            category: "feature",
            message: "希望支持导出 PDF",
            context: JSON.stringify({ route: "/report", lastRunId: "run-abc-123" }),
            status: "acknowledged",
            has_attachment: 1,
          }),
        ],
      });
      await openFeedbackTab();
      await waitFor(() => {
        expect(screen.getByText("反馈内容 0")).toBeInTheDocument();
      });
      expect(screen.getByText("user@test.dev")).toBeInTheDocument();
      expect(screen.getByText("缺陷")).toBeInTheDocument();
      expect(screen.getByText("未知用户")).toBeInTheDocument();
      expect(screen.getByText("功能建议")).toBeInTheDocument();
      expect(screen.getByText("希望支持导出 PDF")).toBeInTheDocument();
      // 上下文摘要：页面路由 + run 前缀（8 字符截断）
      expect(screen.getByText(/页面: \/canvas/)).toBeInTheDocument();
      expect(screen.getByText(/Run: run-abc-/)).toBeInTheDocument();
      // 附件走懒加载 <img>
      const img = screen.getByAltText("反馈截图");
      expect(img).toHaveAttribute("src", "/api/feedback/f-1/attachment");
    });

    it("空反馈显示空态", async () => {
      await openFeedbackTab();
      await waitFor(() => {
        expect(screen.getByText("暂无反馈")).toBeInTheDocument();
      });
    });

    it("状态筛选切换会带 status 重新请求", async () => {
      mockListFeedback.mockResolvedValue({ items: [feedbackItem(0)] });
      await openFeedbackTab();
      await waitFor(() => {
        expect(mockListFeedback).toHaveBeenCalledWith({});
      });
      fireEvent.click(screen.getByRole("radio", { name: "已关闭" }));
      await waitFor(() => {
        expect(mockListFeedback).toHaveBeenLastCalledWith({ status: "closed" });
      });
    });

    it("切换状态 select 乐观更新并调用 API", async () => {
      mockListFeedback.mockResolvedValue({ items: [feedbackItem(0)] });
      await openFeedbackTab();
      await waitFor(() => {
        expect(screen.getByText("反馈内容 0")).toBeInTheDocument();
      });
      const select = screen.getByLabelText("反馈") as HTMLSelectElement;
      expect(select.value).toBe("open");
      fireEvent.change(select, { target: { value: "acknowledged" } });
      await waitFor(() => {
        expect(mockUpdateFeedbackStatus).toHaveBeenCalledWith("f-0", "acknowledged");
      });
      expect((screen.getByLabelText("反馈") as HTMLSelectElement).value).toBe("acknowledged");
    });

    it("状态更新失败回滚并显示错误", async () => {
      mockListFeedback.mockResolvedValue({ items: [feedbackItem(0)] });
      mockUpdateFeedbackStatus.mockRejectedValue(new Error("boom"));
      await openFeedbackTab();
      await waitFor(() => {
        expect(screen.getByText("反馈内容 0")).toBeInTheDocument();
      });
      const select = screen.getByLabelText("反馈") as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "closed" } });
      await waitFor(() => {
        expect(screen.getByText("状态更新失败")).toBeInTheDocument();
      });
      expect((screen.getByLabelText("反馈") as HTMLSelectElement).value).toBe("open");
    });

    it("反馈加载失败渲染错误提示", async () => {
      mockListFeedback.mockRejectedValue(new Error("boom"));
      await openFeedbackTab();
      await waitFor(() => {
        expect(screen.getByText("反馈加载失败")).toBeInTheDocument();
      });
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
