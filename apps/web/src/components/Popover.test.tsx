import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Popover, { type Rect } from "./Popover";

const anchor: Rect = { top: 100, left: 100, width: 80, height: 24, bottom: 124, right: 180 };

describe("Popover", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <Popover open={false} anchor={anchor}>
        content
      </Popover>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("renders nothing when anchor is null", () => {
    render(
      <Popover open anchor={null}>
        content
      </Popover>,
    );
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("renders children in a portal when open with an anchor", () => {
    render(
      <Popover open anchor={anchor}>
        <span>popover content</span>
      </Popover>,
    );
    const el = screen.getByText("popover content");
    expect(el).toBeInTheDocument();
    // Portal renders to document.body, not inside the test container
    expect(el.closest(".popover")).toBeInTheDocument();
  });

  it("applies custom className alongside popover", () => {
    render(
      <Popover open anchor={anchor} className="tooltip">
        content
      </Popover>,
    );
    const popover = document.querySelector(".popover");
    expect(popover?.className).toContain("tooltip");
  });

  it("uses position fixed with z-index from CSS variable", () => {
    render(
      <Popover open anchor={anchor}>
        content
      </Popover>,
    );
    const popover = document.querySelector(".popover") as HTMLElement;
    expect(popover.style.position).toBe("fixed");
    expect(popover.style.zIndex).toBe("var(--z-popover, 1000)");
  });

  it("adds scroll and resize listeners when opened", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    render(
      <Popover open anchor={anchor}>
        content
      </Popover>,
    );
    const types = addSpy.mock.calls.map(([type]) => type);
    expect(types).toContain("scroll");
    expect(types).toContain("resize");
    addSpy.mockRestore();
  });

  it("removes scroll and resize listeners on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(
      <Popover open anchor={anchor}>
        content
      </Popover>,
    );
    unmount();
    const types = removeSpy.mock.calls.map(([type]) => type);
    expect(types).toContain("scroll");
    expect(types).toContain("resize");
    removeSpy.mockRestore();
  });
});
