import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import UserMenu from "./UserMenu";

// Mock Tooltip
vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

// Mock AccountDialog
const mockAccountDialogOnClose = vi.fn();
vi.mock("./AccountDialog", () => ({
  default: ({ open, me, onClose }: any) => {
    mockAccountDialogOnClose.mockImplementation(onClose);
    return open ? (
      <div data-testid="account-dialog" data-email={me?.email ?? ""}>
        <span>账户对话框</span>
        <button onClick={onClose}>关闭账户</button>
      </div>
    ) : null;
  },
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

function mockFetchMe(user: { id: string; email: string } | null) {
  global.fetch = vi.fn(async () => {
    if (user) {
      return {
        ok: true,
        json: async () => ({ user }),
      } as any;
    }
    return { ok: false } as any;
  }) as any;
}

describe("UserMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.location.assign
    delete (window as any).location;
    (window as any).location = { assign: vi.fn() };
  });

  afterEach(() => {
    // Restore window.location
    (window as any).location = window.location;
  });

  describe("加载状态", () => {
    it("未加载完成时显示'·'头像", () => {
      global.fetch = vi.fn(() => new Promise(() => {})) as any;
      render(<UserMenu />);
      expect(screen.getByText("·")).toBeInTheDocument();
    });

    it("未加载完成时显示'账户'按钮", () => {
      global.fetch = vi.fn(() => new Promise(() => {})) as any;
      render(<UserMenu />);
      expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
    });
  });

  describe("已登录", () => {
    beforeEach(() => {
      mockFetchMe({ id: "user-1", email: "test@example.com" });
    });

    it("显示邮箱首字母大写头像", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByText("T")).toBeInTheDocument();
      });
    });

    it("显示'账户'按钮", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
    });

    it("Tooltip 显示已登录邮箱", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        const chip = screen.getByRole("button", { name: /账户/ });
        expect(chip.closest("[title]")).toHaveAttribute("title", "已登录：test@example.com");
      });
    });

    it("有 user-menu class", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(document.querySelector(".user-menu")).toBeInTheDocument();
      });
    });

    it("有 user-menu__chip class", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(document.querySelector(".user-menu__chip")).toBeInTheDocument();
      });
    });

    it("有 user-menu__avatar class", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(document.querySelector(".user-menu__avatar")).toBeInTheDocument();
      });
    });
  });

  describe("菜单展开", () => {
    beforeEach(() => {
      mockFetchMe({ id: "user-1", email: "test@example.com" });
    });

    it("点击账户按钮展开菜单", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(screen.getByText("个人中心")).toBeInTheDocument();
      expect(screen.getByText("退出登录")).toBeInTheDocument();
    });

    it("菜单显示用户邮箱", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(screen.getByText("test@example.com")).toBeInTheDocument();
    });

    it("再次点击账户按钮关闭菜单", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(screen.getByText("个人中心")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(screen.queryByText("个人中心")).not.toBeInTheDocument();
    });

    it("菜单有 user-menu__pop class", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(document.querySelector(".user-menu__pop")).toBeInTheDocument();
    });

    it("邮箱有 user-menu__email class", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(document.querySelector(".user-menu__email")).toBeInTheDocument();
    });

    it("退出登录按钮有 user-menu__logout class", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(document.querySelector(".user-menu__logout")).toBeInTheDocument();
    });
  });

  describe("个人中心", () => {
    beforeEach(() => {
      mockFetchMe({ id: "user-1", email: "test@example.com" });
    });

    it("点击个人中心打开 AccountDialog", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      fireEvent.click(screen.getByText("个人中心"));
      expect(screen.getByTestId("account-dialog")).toBeInTheDocument();
    });

    it("点击个人中心关闭菜单", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      fireEvent.click(screen.getByText("个人中心"));
      expect(screen.queryByText("个人中心")).not.toBeInTheDocument();
    });

    it("AccountDialog 接收用户邮箱", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      fireEvent.click(screen.getByText("个人中心"));
      expect(screen.getByTestId("account-dialog")).toHaveAttribute("data-email", "test@example.com");
    });
  });

  describe("退出登录", () => {
    beforeEach(() => {
      mockFetchMe({ id: "user-1", email: "test@example.com" });
      mockLogout.mockResolvedValue(undefined);
    });

    it("点击退出登录调用 logout", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      fireEvent.click(screen.getByText("退出登录"));
      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalledTimes(1);
      });
    });

    it("退出登录后跳转到 /login", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      fireEvent.click(screen.getByText("退出登录"));
      await waitFor(() => {
        expect((window as any).location.assign).toHaveBeenCalledWith("/login");
      });
    });
  });

  describe("管理入口", () => {
    async function openMenu(role?: string) {
      mockFetchMe({ id: "user-1", email: "test@example.com", role });
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
    }

    it("owner 显示'管理'入口", async () => {
      await openMenu("owner");
      expect(screen.getByText("管理")).toBeInTheDocument();
    });

    it("admin 显示'管理'入口", async () => {
      await openMenu("admin");
      expect(screen.getByText("管理")).toBeInTheDocument();
    });

    it("普通用户不显示'管理'入口", async () => {
      await openMenu("user");
      expect(screen.queryByText("管理")).not.toBeInTheDocument();
    });

    it("无角色信息不显示'管理'入口", async () => {
      await openMenu(undefined);
      expect(screen.queryByText("管理")).not.toBeInTheDocument();
    });

    it("点击'管理'打开 AdminPanel 并关闭菜单", async () => {
      await openMenu("owner");
      fireEvent.click(screen.getByText("管理"));
      expect(screen.getByTestId("admin-panel")).toBeInTheDocument();
      expect(screen.getByTestId("admin-panel")).toHaveAttribute("data-role", "owner");
      expect(screen.queryByText("个人中心")).not.toBeInTheDocument();
    });
  });

  describe("外部点击关闭", () => {
    beforeEach(() => {
      mockFetchMe({ id: "user-1", email: "test@example.com" });
    });

    it("点击菜单外部关闭菜单", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(screen.getByText("个人中心")).toBeInTheDocument();
      // 点击 document 外部
      fireEvent.mouseDown(document.body);
      expect(screen.queryByText("个人中心")).not.toBeInTheDocument();
    });
  });

  describe("Escape 键关闭", () => {
    beforeEach(() => {
      mockFetchMe({ id: "user-1", email: "test@example.com" });
    });

    it("按 Escape 键关闭菜单", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(screen.getByText("个人中心")).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByText("个人中心")).not.toBeInTheDocument();
    });
  });

  describe("未登录", () => {
    beforeEach(() => {
      mockFetchMe(null);
    });

    it("未登录时显示'·'头像", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByText("·")).toBeInTheDocument();
      });
    });

    it("未登录时 Tooltip 显示'账户'", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        const chip = screen.getByRole("button", { name: /账户/ });
        expect(chip.closest("[title]")).toHaveAttribute("title", "账户");
      });
    });

    it("菜单展开时邮箱显示'…'", async () => {
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /账户/ })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: /账户/ }));
      expect(screen.getByText("…")).toBeInTheDocument();
    });
  });

  describe("API 调用", () => {
    it("组件挂载时调用 /api/auth/me", async () => {
      mockFetchMe({ id: "user-1", email: "test@example.com" });
      render(<UserMenu />);
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/auth/me", {
          credentials: "include",
        });
      });
    });

    it("API 调用失败时不崩溃", async () => {
      global.fetch = vi.fn(async () => {
        throw new Error("Network error");
      }) as any;
      render(<UserMenu />);
      await waitFor(() => {
        expect(screen.getByText("·")).toBeInTheDocument();
      });
    });
  });
});
