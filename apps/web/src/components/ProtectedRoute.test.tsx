import { render, screen, waitFor } from "@testing-library/react";
import ProtectedRoute from "./ProtectedRoute";

// Mock react-router-dom Navigate
const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) => {
    mockNavigate({ to, replace });
    return null;
  },
}));

function renderComponent() {
  return render(
    <ProtectedRoute>
      <div data-testid="protected-content">Protected Content</div>
    </ProtectedRoute>,
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("加载状态", () => {
    it("初始显示加载中", () => {
      global.fetch = vi.fn(() => new Promise(() => {})) as any;
      renderComponent();
      expect(screen.getByText("加载中…")).toBeInTheDocument();
    });

    it("加载状态有 auth-page class", () => {
      global.fetch = vi.fn(() => new Promise(() => {})) as any;
      renderComponent();
      expect(document.querySelector(".auth-page")).toBeInTheDocument();
    });

    it("加载时不渲染 children", () => {
      global.fetch = vi.fn(() => new Promise(() => {})) as any;
      renderComponent();
      expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    });
  });

  describe("已登录", () => {
    it("fetch 返回 ok 时渲染 children", async () => {
      global.fetch = vi.fn(async () => ({ ok: true })) as any;
      renderComponent();
      await waitFor(() => {
        expect(screen.getByTestId("protected-content")).toBeInTheDocument();
      });
    });

    it("已登录时不重定向", async () => {
      global.fetch = vi.fn(async () => ({ ok: true })) as any;
      renderComponent();
      await waitFor(() => {
        expect(screen.getByTestId("protected-content")).toBeInTheDocument();
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("调用 /api/auth/me 且带 credentials", async () => {
      global.fetch = vi.fn(async () => ({ ok: true })) as any;
      renderComponent();
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/auth/me", {
          credentials: "include",
        });
      });
    });
  });

  describe("未登录", () => {
    it("fetch 返回非 ok 时重定向到 /login", async () => {
      global.fetch = vi.fn(async () => ({ ok: false, status: 401 })) as any;
      renderComponent();
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith({ to: "/login", replace: true });
      });
    });

    it("fetch 抛错时重定向到 /login", async () => {
      global.fetch = vi.fn(async () => {
        throw new Error("Network error");
      }) as any;
      renderComponent();
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith({ to: "/login", replace: true });
      });
    });

    it("未登录时不渲染 children", async () => {
      global.fetch = vi.fn(async () => ({ ok: false })) as any;
      renderComponent();
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalled();
      });
      expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    });
  });
});
