import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import AccountDialog from "./AccountDialog";
import type { Me } from "./UserMenu";

const sampleMe: Me = {
  id: "user-1",
  email: "test@example.com",
  createdAt: "2024-01-15T08:30:00Z",
};

beforeEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderComponent(overrides: Partial<{
  open: boolean;
  me: Me | null;
  onClose: () => void;
}> = {}) {
  const onClose = vi.fn();
  render(
    <AccountDialog
      open={overrides.open ?? true}
      me={overrides.me ?? sampleMe}
      onClose={overrides.onClose ?? onClose}
    />,
  );
  return { onClose: overrides.onClose ?? onClose };
}

describe("AccountDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn() as any;
  });

  describe("渲染", () => {
    it("open=false 时返回 null", () => {
      const { container } = render(<AccountDialog open={false} me={sampleMe} onClose={vi.fn()} />);
      expect(container.firstChild).toBeNull();
    });

    it("显示'个人中心'标题", () => {
      renderComponent();
      expect(screen.getByText("个人中心")).toBeInTheDocument();
    });

    it("显示关闭按钮（✕）", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
    });

    it("显示用户邮箱", () => {
      renderComponent();
      expect(screen.getByText("test@example.com")).toBeInTheDocument();
    });

    it("显示邮箱首字母大写头像", () => {
      renderComponent();
      expect(screen.getByText("T")).toBeInTheDocument();
    });

    it("显示注册日期", () => {
      renderComponent();
      expect(screen.getByText(/注册于/)).toBeInTheDocument();
    });

    it("显示'修改密码'标签", () => {
      renderComponent();
      expect(screen.getByText("修改密码")).toBeInTheDocument();
    });

    it("显示当前密码输入框", () => {
      renderComponent();
      expect(screen.getByLabelText("当前密码")).toBeInTheDocument();
    });

    it("显示新密码输入框", () => {
      renderComponent();
      expect(screen.getByLabelText("新密码")).toBeInTheDocument();
    });

    it("显示确认新密码输入框", () => {
      renderComponent();
      expect(screen.getByLabelText("确认新密码")).toBeInTheDocument();
    });

    it("显示更新密码按钮", () => {
      renderComponent();
      expect(screen.getByRole("button", { name: "更新密码" })).toBeInTheDocument();
    });

    it("有 modal-backdrop class", () => {
      renderComponent();
      expect(document.querySelector(".modal-backdrop")).toBeInTheDocument();
    });

    it("有 account-modal class", () => {
      renderComponent();
      expect(document.querySelector(".account-modal")).toBeInTheDocument();
    });

    it("有 account-info class", () => {
      renderComponent();
      expect(document.querySelector(".account-info")).toBeInTheDocument();
    });

    it("有 account-form class", () => {
      renderComponent();
      expect(document.querySelector(".account-form")).toBeInTheDocument();
    });
  });

  describe("用户信息", () => {
    it("me=null 时邮箱显示'…'", () => {
      const { container } = render(<AccountDialog open={true} me={null} onClose={vi.fn()} />);
      const email = container.querySelector(".account-info__email");
      expect(email?.textContent).toBe("…");
    });

    it("me=null 时头像显示'?'", () => {
      const { container } = render(<AccountDialog open={true} me={null} onClose={vi.fn()} />);
      const avatar = container.querySelector(".account-info__avatar");
      expect(avatar?.textContent).toBe("?");
    });

    it("me 无 createdAt 时不显示注册日期", () => {
      const me: Me = { id: "user-1", email: "test@example.com" };
      renderComponent({ me });
      expect(screen.queryByText(/注册于/)).not.toBeInTheDocument();
    });

    it("邮箱首字母正确大写", () => {
      const me: Me = { id: "user-1", email: "alice@example.com" };
      renderComponent({ me });
      expect(screen.getByText("A")).toBeInTheDocument();
    });
  });

  describe("密码输入框属性", () => {
    it("当前密码输入框 type=password", () => {
      renderComponent();
      expect(screen.getByLabelText("当前密码")).toHaveAttribute("type", "password");
    });

    it("当前密码输入框 autoComplete=current-password", () => {
      renderComponent();
      expect(screen.getByLabelText("当前密码")).toHaveAttribute("autocomplete", "current-password");
    });

    it("新密码输入框 type=password", () => {
      renderComponent();
      expect(screen.getByLabelText("新密码")).toHaveAttribute("type", "password");
    });

    it("新密码输入框 minLength=6", () => {
      renderComponent();
      expect(screen.getByLabelText("新密码")).toHaveAttribute("minlength", "6");
    });

    it("新密码输入框 autoComplete=new-password", () => {
      renderComponent();
      expect(screen.getByLabelText("新密码")).toHaveAttribute("autocomplete", "new-password");
    });

    it("确认新密码输入框 type=password", () => {
      renderComponent();
      expect(screen.getByLabelText("确认新密码")).toHaveAttribute("type", "password");
    });

    it("确认新密码输入框 minLength=6", () => {
      renderComponent();
      expect(screen.getByLabelText("确认新密码")).toHaveAttribute("minlength", "6");
    });
  });

  describe("密码一致性验证", () => {
    it("两次新密码不一致时显示错误", () => {
      renderComponent();
      fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "oldpass" } });
      fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass1" } });
      fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass2" } });
      fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
      expect(screen.getByText("两次输入的新密码不一致")).toBeInTheDocument();
    });

    it("密码不一致时不调用 fetch", () => {
      renderComponent();
      fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "oldpass" } });
      fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass1" } });
      fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass2" } });
      fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("错误信息有 auth-error class", () => {
      renderComponent();
      fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "oldpass" } });
      fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass1" } });
      fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass2" } });
      fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
      expect(document.querySelector(".auth-error")).toBeInTheDocument();
    });
  });

  describe("提交密码修改", () => {
    beforeEach(() => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
    });

    it("提交时调用 /api/auth/password POST", async () => {
      renderComponent();
      fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "oldpass" } });
      fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass123" } });
      fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass123" } });
      fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/auth/password",
          expect.objectContaining({
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
          }),
        );
      });
    });

    it("提交时发送正确的请求体", async () => {
      renderComponent();
      fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "oldpass" } });
      fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass123" } });
      fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass123" } });
      fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
      await waitFor(() => {
        const callArg = (global.fetch as any).mock.calls[0][1];
        expect(JSON.parse(callArg.body)).toEqual({
          currentPassword: "oldpass",
          newPassword: "newpass123",
        });
      });
    });

    it("提交成功后显示'密码已更新'", async () => {
      renderComponent();
      fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "oldpass" } });
      fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass123" } });
      fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass123" } });
      fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
      await waitFor(() => {
        expect(screen.getByText("密码已更新")).toBeInTheDocument();
      });
    });

    it("成功信息有 account-ok class", async () => {
      renderComponent();
      fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "oldpass" } });
      fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass123" } });
      fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass123" } });
      fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
      await waitFor(() => {
        expect(document.querySelector(".account-ok")).toBeInTheDocument();
      });
    });

    it("提交成功后清空输入框", async () => {
      renderComponent();
      fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "oldpass" } });
      fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass123" } });
      fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass123" } });
      fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
      await waitFor(() => {
        expect(screen.getByLabelText("当前密码")).toHaveValue("");
        expect(screen.getByLabelText("新密码")).toHaveValue("");
        expect(screen.getByLabelText("确认新密码")).toHaveValue("");
      });
    });

    it("提交中按钮显示'提交中…'", async () => {
      (global.fetch as any).mockImplementation(() => new Promise(() => {}));
      renderComponent();
      fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "oldpass" } });
      fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass123" } });
      fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass123" } });
      fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "提交中…" })).toBeInTheDocument();
      });
    });

    it("提交中按钮禁用", async () => {
      (global.fetch as any).mockImplementation(() => new Promise(() => {}));
      renderComponent();
      fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "oldpass" } });
      fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass123" } });
      fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass123" } });
      fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "提交中…" })).toBeDisabled();
      });
    });
  });

  describe("提交失败", () => {
    it("API 返回错误时显示错误信息", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "当前密码不正确" }),
      });
      renderComponent();
      fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "wrongpass" } });
      fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass123" } });
      fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass123" } });
      fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
      await waitFor(() => {
        expect(screen.getByText("当前密码不正确")).toBeInTheDocument();
      });
    });

    it("API 返回无 error 字段时显示默认错误", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });
      renderComponent();
      fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "oldpass" } });
      fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass123" } });
      fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass123" } });
      fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
      await waitFor(() => {
        expect(screen.getByText("请求失败 (500)")).toBeInTheDocument();
      });
    });

    it("网络错误时显示错误信息", async () => {
      (global.fetch as any).mockRejectedValue(new Error("Network error"));
      renderComponent();
      fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "oldpass" } });
      fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass123" } });
      fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass123" } });
      fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
      await waitFor(() => {
        expect(screen.getByText("Network error")).toBeInTheDocument();
      });
    });

    it("失败后按钮恢复可用", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "错误" }),
      });
      renderComponent();
      fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "oldpass" } });
      fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "newpass123" } });
      fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "newpass123" } });
      fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "更新密码" })).not.toBeDisabled();
      });
    });
  });

  describe("关闭", () => {
    it("点击关闭按钮调用 onClose", () => {
      const { onClose } = renderComponent();
      fireEvent.click(screen.getByRole("button", { name: "关闭" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击背景调用 onClose", () => {
      const { onClose } = renderComponent();
      const backdrop = document.querySelector(".modal-backdrop")!;
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("点击模态框内容不调用 onClose", () => {
      const { onClose } = renderComponent();
      const modal = document.querySelector(".account-modal")!;
      fireEvent.click(modal);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("按 Escape 键调用 onClose", () => {
      const { onClose } = renderComponent();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("open=false 时不监听 Escape 键", () => {
      const onClose = vi.fn();
      render(<AccountDialog open={false} me={sampleMe} onClose={onClose} />);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("状态重置", () => {
    it("打开时重置表单状态", () => {
      const { rerender } = render(
        <AccountDialog open={false} me={sampleMe} onClose={vi.fn()} />,
      );
      rerender(<AccountDialog open={true} me={sampleMe} onClose={vi.fn()} />);
      expect(screen.getByLabelText("当前密码")).toHaveValue("");
      expect(screen.getByLabelText("新密码")).toHaveValue("");
      expect(screen.getByLabelText("确认新密码")).toHaveValue("");
    });

    it("重新打开时清除错误信息", async () => {
      const { rerender } = render(
        <AccountDialog open={true} me={sampleMe} onClose={vi.fn()} />,
      );
      // 触发密码不一致错误
      fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "oldpass" } });
      fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "pass1" } });
      fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "pass2" } });
      fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
      expect(screen.getByText("两次输入的新密码不一致")).toBeInTheDocument();
      // 关闭再打开
      rerender(<AccountDialog open={false} me={sampleMe} onClose={vi.fn()} />);
      rerender(<AccountDialog open={true} me={sampleMe} onClose={vi.fn()} />);
      expect(screen.queryByText("两次输入的新密码不一致")).not.toBeInTheDocument();
    });
  });
});
