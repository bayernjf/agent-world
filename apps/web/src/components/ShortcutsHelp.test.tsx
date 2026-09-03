import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import ShortcutsHelp from "./ShortcutsHelp";

describe("ShortcutsHelp", () => {
  // Popover computes position inside requestAnimationFrame; stub it so the
  // portal becomes visibility:visible synchronously (otherwise getByRole
  // excludes it from the accessibility tree).
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => cb(0));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderShortcuts = () => {
    const utils = render(<ShortcutsHelp />);
    const wrapper = utils.container.querySelector(".shortcuts") as HTMLElement;
    return { ...utils, wrapper };
  };

  it("renders the trigger button", () => {
    renderShortcuts();
    expect(screen.getByRole("button", { name: "快捷键 ?" })).toBeInTheDocument();
  });

  it("does not show the shortcuts panel initially", () => {
    renderShortcuts();
    expect(screen.queryByRole("dialog", { name: "快捷键说明" })).not.toBeInTheDocument();
  });

  it("shows the shortcuts panel on mouse enter", () => {
    const { wrapper } = renderShortcuts();
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole("dialog", { name: "快捷键说明" })).toBeInTheDocument();
  });

  it("hides the shortcuts panel on mouse leave", () => {
    const { wrapper } = renderShortcuts();
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole("dialog", { name: "快捷键说明" })).toBeInTheDocument();
    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole("dialog", { name: "快捷键说明" })).not.toBeInTheDocument();
  });

  it("shows the shortcuts panel on focus", () => {
    const { wrapper } = renderShortcuts();
    fireEvent.focus(wrapper);
    expect(screen.getByRole("dialog", { name: "快捷键说明" })).toBeInTheDocument();
  });

  it("hides the shortcuts panel on blur", () => {
    const { wrapper } = renderShortcuts();
    fireEvent.focus(wrapper);
    expect(screen.getByRole("dialog", { name: "快捷键说明" })).toBeInTheDocument();
    fireEvent.blur(wrapper);
    expect(screen.queryByRole("dialog", { name: "快捷键说明" })).not.toBeInTheDocument();
  });

  it("renders all four shortcut groups", () => {
    const { wrapper } = renderShortcuts();
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByText("画布")).toBeInTheDocument();
    expect(screen.getByText("编辑")).toBeInTheDocument();
    expect(screen.getByText("工具")).toBeInTheDocument();
    expect(screen.getByText("其他")).toBeInTheDocument();
  });

  it("renders specific shortcut entries", () => {
    const { wrapper } = renderShortcuts();
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByText("撤销")).toBeInTheDocument();
    expect(screen.getByText("删除选中节点或管道")).toBeInTheDocument();
    expect(screen.getByText("缩放并居中到选中节点")).toBeInTheDocument();
  });

  it("panel has correct heading", () => {
    const { wrapper } = renderShortcuts();
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByText("快捷键")).toBeInTheDocument();
  });
});
