import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import MustChangePassword from "./MustChangePassword";

beforeEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function fill(current = "one-time-pw", next = "my-own-secret", confirm = "my-own-secret") {
  const onDone = vi.fn();
  render(<MustChangePassword email="mate@aw.test" onDone={onDone} />);
  fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("新密码"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: "保存并进入" }));
  return { onDone };
}

describe("MustChangePassword", () => {
  it("点名这是哪个账号、为什么要改", () => {
    render(<MustChangePassword email="mate@aw.test" onDone={vi.fn()} />);
    expect(screen.getByText("设置你的密码")).toBeInTheDocument();
    expect(screen.getByText(/mate@aw\.test/)).toBeInTheDocument();
  });

  it("两次新密码不一致时根本不发请求", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;
    const { onDone } = fill("one-time-pw", "secret123", "different123");
    await waitFor(() =>
      expect(screen.getByText("两次输入的新密码不一致")).toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("提交走 /api/auth/password，成功后交给父级决定去哪", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    global.fetch = fetchMock as any;
    const { onDone } = fill();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ currentPassword: "one-time-pw", newPassword: "my-own-secret" }),
      }),
    );
  });

  it("服务端拒绝时把原因说出来，并且不假装通过", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "当前密码不正确" }),
    }) as any;
    const { onDone } = fill();
    await waitFor(() => expect(screen.getByText("当前密码不正确")).toBeInTheDocument());
    expect(onDone).not.toHaveBeenCalled();
    // Button is usable again — otherwise the only way out is a reload.
    expect(screen.getByRole("button", { name: "保存并进入" })).toBeEnabled();
  });

  it("请求进行中禁用按钮", async () => {
    let release: (v: unknown) => void = () => {};
    global.fetch = vi.fn().mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    ) as any;
    const { onDone } = fill();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled(),
    );
    expect(onDone).not.toHaveBeenCalled();
    release({ ok: true, json: () => Promise.resolve({ ok: true }) });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});
