import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ConfirmDialog from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmDialog open={false} title="t" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders title, description and default button labels", () => {
    render(
      <ConfirmDialog
        open
        title="删除产线？"
        description="此操作不可撤销"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("删除产线？")).toBeInTheDocument();
    expect(screen.getByText("此操作不可撤销")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确定" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

  it("uses custom confirm/cancel labels", () => {
    render(
      <ConfirmDialog
        open
        title="t"
        confirmLabel="Yes, delete"
        cancelLabel="No, keep"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("button", { name: "Yes, delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No, keep" })).toBeInTheDocument();
  });

  it("applies danger styling when danger is true", () => {
    render(
      <ConfirmDialog open title="t" danger onConfirm={onConfirm} onCancel={onCancel} />,
    );
    const confirm = screen.getByRole("button", { name: "确定" });
    expect(confirm.className).toContain("btn--danger");
  });

  it("calls onConfirm when confirm button is clicked", () => {
    render(<ConfirmDialog open title="t" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel when cancel button is clicked", () => {
    render(<ConfirmDialog open title="t" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onCancel when backdrop is clicked", () => {
    render(<ConfirmDialog open title="t" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(document.querySelector(".modal-backdrop")!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not call onCancel when clicking inside the dialog", () => {
    render(<ConfirmDialog open title="t" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(document.querySelector(".modal-confirm")!);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel when Escape is pressed", () => {
    render(<ConfirmDialog open title="t" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not listen for Escape when closed", () => {
    const { rerender } = render(
      <ConfirmDialog open={false} title="t" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    rerender(<ConfirmDialog open title="t" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("confirm button receives focus on mount (autoFocus)", () => {
    render(<ConfirmDialog open title="t" onConfirm={onConfirm} onCancel={onCancel} />);
    const confirm = screen.getByRole("button", { name: "确定" });
    expect(document.activeElement).toBe(confirm);
  });
});
