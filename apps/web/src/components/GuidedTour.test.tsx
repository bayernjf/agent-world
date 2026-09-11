import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import GuidedTour from "./GuidedTour";
import { useGuidedTour, hasSeen } from "../store/guided-tour";

beforeEach(() => {
  localStorage.clear();
  useGuidedTour.setState({ activeTourId: null, index: 0, total: 0 });
});

describe("GuidedTour", () => {
  it("renders nothing when no tour is active", () => {
    const { container } = render(<GuidedTour />);
    expect(container.querySelector(".guided-tour")).toBeNull();
  });

  it("renders the centered welcome step with progress and disabled back", () => {
    render(<GuidedTour />);
    act(() => useGuidedTour.getState().start("first-run"));
    expect(screen.getByText("欢迎来到 Agent World")).toBeTruthy();
    expect(screen.getByText("第 1 / 8 步")).toBeTruthy();
    const back = screen.getByRole("button", { name: "上一步" });
    expect(back.hasAttribute("disabled")).toBe(true);
  });

  it("advances to the next step and falls back to a centered card when the anchor is missing", async () => {
    render(<GuidedTour />);
    act(() => useGuidedTour.getState().start("first-run"));
    act(() => useGuidedTour.getState().next());
    // raw:input anchor is absent in jsdom → engine retries then shows centered.
    await waitFor(() =>
      expect(screen.getByText("原料台 · 产线的输入口")).toBeTruthy(),
    );
    expect(screen.getByText("第 2 / 8 步")).toBeTruthy();
  });

  it("marks seen and closes on skip", () => {
    render(<GuidedTour />);
    act(() => useGuidedTour.getState().start("first-run"));
    fireEvent.click(screen.getByRole("button", { name: "跳过引导" }));
    expect(useGuidedTour.getState().activeTourId).toBeNull();
    expect(hasSeen("first-run", "1.0.0")).toBe(true);
  });

  it("closes on Escape and marks seen", () => {
    render(<GuidedTour />);
    act(() => useGuidedTour.getState().start("first-run"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(useGuidedTour.getState().activeTourId).toBeNull();
  });

  it("finishes from the last step", () => {
    render(<GuidedTour />);
    act(() => useGuidedTour.getState().start("first-run", 7));
    expect(screen.getByText("你已就绪")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(useGuidedTour.getState().activeTourId).toBeNull();
    expect(hasSeen("first-run", "1.0.0")).toBe(true);
  });

  it("exposes dialog a11y attributes", () => {
    render(<GuidedTour />);
    act(() => useGuidedTour.getState().start("first-run"));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("guided-tour-title");
  });
});
