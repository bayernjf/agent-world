import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useToast } from "../store/toast";
import Toast from "./Toast";

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToast.setState({ toast: null });
    // jsdom may not have clipboard; stub it so the default copy action resolves
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    useToast.setState({ toast: null });
  });

  const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

  it("renders nothing when there is no toast", () => {
    const { container } = render(<Toast />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the toast message", () => {
    useToast.setState({ toast: { id: 1, message: "保存成功", ttlMs: 4000 } });
    render(<Toast />);
    expect(screen.getByText("保存成功")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows a default 复制 action when no custom actions are provided", () => {
    useToast.setState({ toast: { id: 1, message: "出错了", ttlMs: 4000 } });
    render(<Toast />);
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
  });

  it("renders custom actions instead of the default copy action", () => {
    const undo = vi.fn();
    useToast.setState({
      toast: { id: 1, message: "已删除", ttlMs: 4000, actions: [{ label: "撤销", onClick: undo }] },
    });
    render(<Toast />);
    expect(screen.getByRole("button", { name: "撤销" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制" })).not.toBeInTheDocument();
  });

  it("calls the custom action onClick and clears the toast when clicked", () => {
    const undo = vi.fn();
    useToast.setState({
      toast: { id: 1, message: "已删除", ttlMs: 4000, actions: [{ label: "撤销", onClick: undo }] },
    });
    render(<Toast />);
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("已删除")).not.toBeInTheDocument();
  });

  it("clears the toast when the default 复制 action is clicked", () => {
    useToast.setState({ toast: { id: 1, message: "copy me", ttlMs: 4000 } });
    render(<Toast />);
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    expect(screen.queryByText("copy me")).not.toBeInTheDocument();
  });

  it("auto-hides after ttlMs", () => {
    useToast.setState({ toast: { id: 1, message: "auto hide", ttlMs: 2000 } });
    render(<Toast />);
    expect(screen.getByText("auto hide")).toBeInTheDocument();
    advance(1999);
    expect(screen.getByText("auto hide")).toBeInTheDocument();
    advance(1);
    expect(screen.queryByText("auto hide")).not.toBeInTheDocument();
  });

  it("uses a 4s default ttl when ttlMs is not specified", () => {
    useToast.setState({ toast: { id: 1, message: "default ttl" } });
    render(<Toast />);
    advance(3999);
    expect(screen.getByText("default ttl")).toBeInTheDocument();
    advance(1);
    expect(screen.queryByText("default ttl")).not.toBeInTheDocument();
  });
});
