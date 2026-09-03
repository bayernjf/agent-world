import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { LoginPage, RegisterPage, logout } from "./AuthPages";

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => mockNavigate,
}));

// Mock Logo
vi.mock("./Logo", () => ({
  default: ({ size }: { size?: number }) => (
    <div data-testid="logo" style={{ width: size ?? 24, height: size ?? 24 }}>Logo</div>
  ),
}));

const LAST_EMAIL_KEY = "agent-world.lastEmail";

describe("LoginPage", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    localStorage.clear();
    mockNavigate.mockClear();
  });

  describe("渲染", () => {
    it("显示 Logo", () => {
      render(<LoginPage />);
      expect(screen.getByTestId("logo")).toBeInTheDocument();
    });

    it("显示 'Agent World' 标题", () => {
      render(<LoginPage />);
      expect(screen.getByText("Agent World")).toBeInTheDocument();
    });

    it("显示注册链接", () => {
      render(<LoginPage />);
      expect(screen.getByText("注册")).toBeInTheDocument();
      expect(screen.getByText("注册").closest("a")).toHaveAttribute("href", "/register");
    });

    it("显示'还没有账号？'文本", () => {
      render(<LoginPage />);
      expect(screen.getByText(/还没有账号？/)).toBeInTheDocument();
    });

    it("显示邮箱输入框", () => {
      render(<LoginPage />);
      expect(screen.getByLabelText("邮箱")).toBeInTheDocument();
    });

    it("邮箱输入框 type=email", () => {
      render(<LoginPage />);
      expect(screen.getByLabelText("邮箱")).toHaveAttribute("type", "email");
    });

    it("邮箱输入框 required", () => {
      render(<LoginPage />);
      expect(screen.getByLabelText("邮箱")).toHaveAttribute("required");
    });

    it("显示密码输入框", () => {
      render(<LoginPage />);
      expect(screen.getByLabelText("密码")).toBeInTheDocument();
    });

    it("密码输入框 type=password", () => {
      render(<LoginPage />);
      expect(screen.getByLabelText("密码")).toHaveAttribute("type", "password");
    });

    it("密码输入框 required", () => {
      render(<LoginPage />);
      expect(screen.getByLabelText("密码")).toHaveAttribute("required");
    });

    it("显示'记住我'复选框", () => {
      render(<LoginPage />);
      expect(document.querySelector(".auth-remember input[type='checkbox']")).toBeInTheDocument();
    });

    it("'记住我'默认选中", () => {
      render(<LoginPage />);
      const checkbox = document.querySelector(".auth-remember input[type='checkbox']") as HTMLInputElement;
      expect(checkbox).toBeChecked();
    });

    it("显示'记住账号 · 7 天内免登录'提示", () => {
      render(<LoginPage />);
      expect(screen.getByText("记住账号 · 7 天内免登录")).toBeInTheDocument();
    });

    it("显示登录按钮", () => {
      render(<LoginPage />);
      expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
    });

    it("有 auth-page class", () => {
      render(<LoginPage />);
      expect(document.querySelector(".auth-page")).toBeInTheDocument();
    });

    it("有 auth-card class", () => {
      render(<LoginPage />);
      expect(document.querySelector(".auth-card")).toBeInTheDocument();
    });

    it("有 auth-card__title class", () => {
      render(<LoginPage />);
      expect(document.querySelector(".auth-card__title")).toBeInTheDocument();
    });
  });

  describe("localStorage 读取", () => {
    it("从 localStorage 读取上次邮箱", () => {
      localStorage.setItem(LAST_EMAIL_KEY, "test@example.com");
      render(<LoginPage />);
      expect(screen.getByLabelText("邮箱")).toHaveValue("test@example.com");
    });

    it("localStorage 无值时邮箱为空", () => {
      render(<LoginPage />);
      expect(screen.getByLabelText("邮箱")).toHaveValue("");
    });

    it("邮箱为空时邮箱输入框 autoFocus", () => {
      render(<LoginPage />);
      expect(screen.getByLabelText("邮箱")).toHaveFocus();
    });

    it("邮箱不为空时密码输入框 autoFocus", () => {
      localStorage.setItem(LAST_EMAIL_KEY, "test@example.com");
      render(<LoginPage />);
      expect(screen.getByLabelText("密码")).toHaveFocus();
    });
  });

  describe("交互", () => {
    it("可以输入邮箱", () => {
      render(<LoginPage />);
      const input = screen.getByLabelText("邮箱");
      fireEvent.change(input, { target: { value: "user@example.com" } });
      expect(input).toHaveValue("user@example.com");
    });

    it("可以输入密码", () => {
      render(<LoginPage />);
      const input = screen.getByLabelText("密码");
      fireEvent.change(input, { target: { value: "password123" } });
      expect(input).toHaveValue("password123");
    });

    it("可以取消'记住我'", () => {
      render(<LoginPage />);
      const checkbox = document.querySelector(".auth-remember input[type='checkbox']") as HTMLInputElement;
      fireEvent.click(checkbox);
      expect(checkbox).not.toBeChecked();
    });
  });

  describe("登录", () => {
    beforeEach(() => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as any);
    });

    it("提交表单调用 fetch", async () => {
      render(<LoginPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.click(screen.getByRole("button", { name: "登录" }));
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledTimes(1);
      });
    });

    it("fetch 调用 /api/auth/login", async () => {
      render(<LoginPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.click(screen.getByRole("button", { name: "登录" }));
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith("/api/auth/login", expect.any(Object));
      });
    });

    it("fetch body 包含邮箱和密码", async () => {
      render(<LoginPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.click(screen.getByRole("button", { name: "登录" }));
      await waitFor(() => {
        const callArgs = (fetch as any).mock.calls[0];
        const body = JSON.parse(callArgs[1].body);
        expect(body.email).toBe("user@example.com");
        expect(body.password).toBe("password123");
        expect(body.remember).toBe(true);
      });
    });

    it("登录成功后导航到首页", async () => {
      render(<LoginPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.click(screen.getByRole("button", { name: "登录" }));
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
      });
    });

    it("记住我时保存邮箱到 localStorage", async () => {
      render(<LoginPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.click(screen.getByRole("button", { name: "登录" }));
      await waitFor(() => {
        expect(localStorage.getItem(LAST_EMAIL_KEY)).toBe("user@example.com");
      });
    });

    it("不记住我时删除邮箱从 localStorage", async () => {
      localStorage.setItem(LAST_EMAIL_KEY, "old@example.com");
      render(<LoginPage />);
      const checkbox = document.querySelector(".auth-remember input[type='checkbox']") as HTMLInputElement;
      fireEvent.click(checkbox);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.click(screen.getByRole("button", { name: "登录" }));
      await waitFor(() => {
        expect(localStorage.getItem(LAST_EMAIL_KEY)).toBeNull();
      });
    });

    it("登录中显示'登录中…'", async () => {
      (global.fetch as any).mockImplementation(() => new Promise(() => {}));
      render(<LoginPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.click(screen.getByRole("button", { name: "登录" }));
      await waitFor(() => {
        expect(screen.getByText("登录中…")).toBeInTheDocument();
      });
    });

    it("登录中按钮禁用", async () => {
      (global.fetch as any).mockImplementation(() => new Promise(() => {}));
      render(<LoginPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.click(screen.getByRole("button", { name: "登录" }));
      await waitFor(() => {
        expect(screen.getByText("登录中…")).toBeDisabled();
      });
    });

    it("登录失败显示错误信息", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "邮箱或密码错误" }),
      });
      render(<LoginPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "wrong" } });
      fireEvent.click(screen.getByRole("button", { name: "登录" }));
      await waitFor(() => {
        expect(screen.getByText("邮箱或密码错误")).toBeInTheDocument();
      });
    });

    it("错误信息有 auth-error class", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "登录失败" }),
      });
      render(<LoginPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "wrong" } });
      fireEvent.click(screen.getByRole("button", { name: "登录" }));
      await waitFor(() => {
        expect(document.querySelector(".auth-error")).toBeInTheDocument();
      });
    });

    it("登录失败后按钮恢复可用", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "登录失败" }),
      });
      render(<LoginPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "wrong" } });
      fireEvent.click(screen.getByRole("button", { name: "登录" }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "登录" })).not.toBeDisabled();
      });
    });
  });
});

describe("RegisterPage", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    localStorage.clear();
    mockNavigate.mockClear();
  });

  describe("渲染", () => {
    it("显示 Logo", () => {
      render(<RegisterPage />);
      expect(screen.getByTestId("logo")).toBeInTheDocument();
    });

    it("显示 'Agent World' 标题", () => {
      render(<RegisterPage />);
      expect(screen.getByText("Agent World")).toBeInTheDocument();
    });

    it("显示登录链接", () => {
      render(<RegisterPage />);
      expect(screen.getByText("登录")).toBeInTheDocument();
      expect(screen.getByText("登录").closest("a")).toHaveAttribute("href", "/login");
    });

    it("显示'已有账号？'文本", () => {
      render(<RegisterPage />);
      expect(screen.getByText(/已有账号？/)).toBeInTheDocument();
    });

    it("显示邮箱输入框", () => {
      render(<RegisterPage />);
      expect(screen.getByLabelText("邮箱")).toBeInTheDocument();
    });

    it("邮箱输入框 autoFocus", () => {
      render(<RegisterPage />);
      expect(screen.getByLabelText("邮箱")).toHaveFocus();
    });

    it("显示密码输入框", () => {
      render(<RegisterPage />);
      expect(screen.getByLabelText("密码")).toBeInTheDocument();
    });

    it("密码输入框 minLength=6", () => {
      render(<RegisterPage />);
      expect(screen.getByLabelText("密码")).toHaveAttribute("minlength", "6");
    });

    it("显示确认密码输入框", () => {
      render(<RegisterPage />);
      expect(screen.getByLabelText("确认密码")).toBeInTheDocument();
    });

    it("确认密码输入框 minLength=6", () => {
      render(<RegisterPage />);
      expect(screen.getByLabelText("确认密码")).toHaveAttribute("minlength", "6");
    });

    it("显示注册按钮", () => {
      render(<RegisterPage />);
      expect(screen.getByRole("button", { name: "注册" })).toBeInTheDocument();
    });
  });

  describe("交互", () => {
    it("可以输入邮箱", () => {
      render(<RegisterPage />);
      const input = screen.getByLabelText("邮箱");
      fireEvent.change(input, { target: { value: "user@example.com" } });
      expect(input).toHaveValue("user@example.com");
    });

    it("可以输入密码", () => {
      render(<RegisterPage />);
      const input = screen.getByLabelText("密码");
      fireEvent.change(input, { target: { value: "password123" } });
      expect(input).toHaveValue("password123");
    });

    it("可以输入确认密码", () => {
      render(<RegisterPage />);
      const input = screen.getByLabelText("确认密码");
      fireEvent.change(input, { target: { value: "password123" } });
      expect(input).toHaveValue("password123");
    });
  });

  describe("注册", () => {
    beforeEach(() => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as any);
    });

    it("密码不一致时显示错误", () => {
      render(<RegisterPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "different" } });
      fireEvent.click(screen.getByRole("button", { name: "注册" }));
      expect(screen.getByText("两次输入的密码不一致")).toBeInTheDocument();
    });

    it("密码不一致时不调用 fetch", () => {
      render(<RegisterPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "different" } });
      fireEvent.click(screen.getByRole("button", { name: "注册" }));
      expect(fetch).not.toHaveBeenCalled();
    });

    it("提交表单调用 fetch", async () => {
      render(<RegisterPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "password123" } });
      fireEvent.click(screen.getByRole("button", { name: "注册" }));
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledTimes(1);
      });
    });

    it("fetch 调用 /api/auth/register", async () => {
      render(<RegisterPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "password123" } });
      fireEvent.click(screen.getByRole("button", { name: "注册" }));
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith("/api/auth/register", expect.any(Object));
      });
    });

    it("fetch body 包含邮箱和密码", async () => {
      render(<RegisterPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "password123" } });
      fireEvent.click(screen.getByRole("button", { name: "注册" }));
      await waitFor(() => {
        const callArgs = (fetch as any).mock.calls[0];
        const body = JSON.parse(callArgs[1].body);
        expect(body.email).toBe("user@example.com");
        expect(body.password).toBe("password123");
      });
    });

    it("注册成功后导航到首页", async () => {
      render(<RegisterPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "password123" } });
      fireEvent.click(screen.getByRole("button", { name: "注册" }));
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
      });
    });

    it("注册中显示'注册中…'", async () => {
      (global.fetch as any).mockImplementation(() => new Promise(() => {}));
      render(<RegisterPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "password123" } });
      fireEvent.click(screen.getByRole("button", { name: "注册" }));
      await waitFor(() => {
        expect(screen.getByText("注册中…")).toBeInTheDocument();
      });
    });

    it("注册失败显示错误信息", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "邮箱已被注册" }),
      });
      render(<RegisterPage />);
      fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "existing@example.com" } });
      fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password123" } });
      fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "password123" } });
      fireEvent.click(screen.getByRole("button", { name: "注册" }));
      await waitFor(() => {
        expect(screen.getByText("邮箱已被注册")).toBeInTheDocument();
      });
    });
  });
});

describe("logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as any);
  });

  it("调用 fetch", async () => {
    await logout();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("调用 /api/auth/logout", async () => {
    await logout();
    expect(fetch).toHaveBeenCalledWith("/api/auth/logout", expect.any(Object));
  });

  it("使用 POST 方法", async () => {
    await logout();
    const callArgs = (fetch as any).mock.calls[0];
    expect(callArgs[1].method).toBe("POST");
  });

  it("包含 credentials: include", async () => {
    await logout();
    const callArgs = (fetch as any).mock.calls[0];
    expect(callArgs[1].credentials).toBe("include");
  });
});
