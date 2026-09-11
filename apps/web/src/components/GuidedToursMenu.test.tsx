import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GuidedToursMenu from "./GuidedToursMenu";
import { markSeen, useGuidedTour } from "../store/guided-tour";

beforeEach(() => {
  localStorage.clear();
  useGuidedTour.setState({ activeTourId: null, index: 0, total: 0 });
});

describe("GuidedToursMenu", () => {
  it("lists every registered tour by its localized title", () => {
    render(<GuidedToursMenu />);
    expect(screen.getByText("引导与新功能")).toBeTruthy();
    expect(screen.getByRole("button", { name: /新手引导/ })).toBeTruthy();
  });

  it("shows a seen badge for a tour already watched", () => {
    markSeen("first-run", "1.0.0");
    render(<GuidedToursMenu />);
    expect(screen.getByText(/已看过/)).toBeTruthy();
  });

  it("starts the tour and fires onReplay when clicked", () => {
    const onReplay = vi.fn();
    render(<GuidedToursMenu onReplay={onReplay} />);
    fireEvent.click(screen.getByRole("button", { name: /新手引导/ }));
    expect(useGuidedTour.getState().activeTourId).toBe("first-run");
    expect(onReplay).toHaveBeenCalledOnce();
  });
});
