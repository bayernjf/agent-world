import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import ClaimDialog from "./ClaimDialog";
import { useSession } from "../store/session";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: "/login" }),
}));

function open(reason: "manual" | "locked" | "quota" = "manual") {
  useSession.getState().openClaim(reason);
}

describe("ClaimDialog", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useSession.setState({ user: { id: "d", email: "demo+x@demo.local", isDemo: true }, claimOpen: false });
  });
  afterEach(() => useSession.setState({ user: null, claimOpen: false }));

  it("关闭时不渲染", () => {
    const { container } = render(<ClaimDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("打开后显示标题与三个输入", () => {
    open();
    render(<ClaimDialog />);
    expect(screen.getByText("注册并保留当前演示内容")).toBeInTheDocument();
    expect(screen.getByLabelText("邮箱")).toBeInTheDocument();
    expect(screen.getByLabelText(/设置密码/)).toBeInTheDocument();
    expect(screen.getByLabelText("确认密码")).toBeInTheDocument();
  });

  it("locked 原因显示对应说明", () => {
    open("locked");
    render(<ClaimDialog />);
    expect(screen.getByText(/该功能需要正式账号/)).toBeInTheDocument();
  });

  it("两次密码不一致时拦截且不发请求", () => {
    global.fetch = vi.fn() as any;
    open();
    render(<ClaimDialog />);
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "me@x.dev" } });
    fireEvent.change(screen.getByLabelText(/设置密码/), { target: { value: "secret123" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: "转正并注册" }));
    expect(screen.getByText("两次输入的密码不一致")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("提交成功调用 claim、刷新 session、关闭并进入首页", async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/claim")) return { ok: true, json: async () => ({ user: { isDemo: false } }) } as any;
      return { ok: true, json: async () => ({ user: { id: "d", email: "me@x.dev", isDemo: false } }) } as any;
    }) as any;
    open();
    render(<ClaimDialog />);
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "me@x.dev" } });
    fireEvent.change(screen.getByLabelText(/设置密码/), { target: { value: "secret123" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "转正并注册" }));
    await waitFor(() => {
      expect(useSession.getState().claimOpen).toBe(false);
      expect(useSession.getState().user?.isDemo).toBe(false);
      expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
    });
  });

  it("邮箱被占用时显示对应错误", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ code: "EMAIL_TAKEN" }),
    })) as any;
    open();
    render(<ClaimDialog />);
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "taken@x.dev" } });
    fireEvent.change(screen.getByLabelText(/设置密码/), { target: { value: "secret123" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "转正并注册" }));
    await waitFor(() => {
      expect(screen.getByText("该邮箱已被其他账号占用")).toBeInTheDocument();
    });
  });
});
