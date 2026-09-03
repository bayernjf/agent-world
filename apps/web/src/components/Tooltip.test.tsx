import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import Tooltip from "./Tooltip";

describe("Tooltip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

  it("renders children as the trigger", () => {
    render(
      <Tooltip content="hint">
        <button>hover me</button>
      </Tooltip>,
    );
    expect(screen.getByRole("button", { name: "hover me" })).toBeInTheDocument();
  });

  it("does not show content before the delay elapses", () => {
    render(
      <Tooltip content="hidden hint">
        <span>trigger</span>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByText("trigger"));
    advance(100); // default delay is 120
    expect(screen.queryByText("hidden hint")).not.toBeInTheDocument();
  });

  it("shows content after the delay on pointer enter", () => {
    render(
      <Tooltip content="visible hint">
        <span>trigger</span>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByText("trigger"));
    advance(120);
    expect(screen.getByText("visible hint")).toBeInTheDocument();
  });

  it("respects a custom delay", () => {
    render(
      <Tooltip content="delayed" delay={300}>
        <span>trigger</span>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByText("trigger"));
    advance(299);
    expect(screen.queryByText("delayed")).not.toBeInTheDocument();
    advance(1);
    expect(screen.getByText("delayed")).toBeInTheDocument();
  });

  it("cancels the pending show when pointer leaves before delay", () => {
    render(
      <Tooltip content="cancelled">
        <span>trigger</span>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByText("trigger"));
    advance(50);
    fireEvent.pointerLeave(screen.getByText("trigger"));
    advance(500);
    expect(screen.queryByText("cancelled")).not.toBeInTheDocument();
  });

  it("hides on pointer leave after being shown", () => {
    render(
      <Tooltip content="bye">
        <span>trigger</span>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByText("trigger"));
    advance(120);
    expect(screen.getByText("bye")).toBeInTheDocument();
    fireEvent.pointerLeave(screen.getByText("trigger"));
    expect(screen.queryByText("bye")).not.toBeInTheDocument();
  });

  it("hides on pointer down", () => {
    render(
      <Tooltip content="down">
        <span>trigger</span>
      </Tooltip>,
    );
    fireEvent.pointerEnter(screen.getByText("trigger"));
    advance(120);
    fireEvent.pointerDown(screen.getByText("trigger"));
    expect(screen.queryByText("down")).not.toBeInTheDocument();
  });

  it("shows on focus and hides on blur", () => {
    render(
      <Tooltip content="focused">
        <span>trigger</span>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText("trigger"));
    advance(120);
    expect(screen.getByText("focused")).toBeInTheDocument();
    fireEvent.blur(screen.getByText("trigger"));
    expect(screen.queryByText("focused")).not.toBeInTheDocument();
  });

  it("applies custom className to the trigger wrapper", () => {
    render(
      <Tooltip content="x" className="my-tooltip">
        <span>trigger</span>
      </Tooltip>,
    );
    const wrapper = screen.getByText("trigger").closest(".tooltip-trigger");
    expect(wrapper?.className).toContain("my-tooltip");
  });
});
