import { render, screen, fireEvent } from "@testing-library/react";
import { useStore } from "zustand";
import { useGraph } from "../store/graph";
import type { ReactNode } from "react";
import UndoRedo from "./UndoRedo";

vi.mock("zustand", () => ({ useStore: vi.fn() }));
vi.mock("../store/graph", () => ({ useGraph: vi.fn() }));
vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

describe("UndoRedo", () => {
  const undo = vi.fn();
  const redo = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useGraph as any).temporal = {};
    useGraph.mockImplementation((selector: (s: any) => any) => selector({ undo, redo }));
  });

  const mockTemporal = (pastLen: number, futureLen: number) => {
    (useStore as any).mockImplementation((_s: unknown, selector: (s: any) => number) =>
      selector({ pastStates: Array(pastLen).fill({}), futureStates: Array(futureLen).fill({}) }),
    );
  };

  it("disables both buttons when there is no history", () => {
    mockTemporal(0, 0);
    render(<UndoRedo />);
    expect(screen.getByLabelText("撤销")).toBeDisabled();
    expect(screen.getByLabelText("重做")).toBeDisabled();
  });

  it("enables undo when past states exist and calls undo on click", () => {
    mockTemporal(3, 0);
    render(<UndoRedo />);
    const undoBtn = screen.getByLabelText("撤销");
    expect(undoBtn).not.toBeDisabled();
    fireEvent.click(undoBtn);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).not.toHaveBeenCalled();
  });

  it("enables redo when future states exist and calls redo on click", () => {
    mockTemporal(0, 2);
    render(<UndoRedo />);
    const redoBtn = screen.getByLabelText("重做");
    expect(redoBtn).not.toBeDisabled();
    fireEvent.click(redoBtn);
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  it("renders both buttons with correct icons", () => {
    mockTemporal(1, 1);
    render(<UndoRedo />);
    expect(screen.getByLabelText("撤销").textContent).toBe("↶");
    expect(screen.getByLabelText("重做").textContent).toBe("↷");
  });

  it("shows the correct tooltip via the mocked Tooltip", () => {
    mockTemporal(1, 1);
    render(<UndoRedo />);
    expect(screen.getByLabelText("撤销").closest("span")?.getAttribute("title")).toBe(
      "撤销 (⌘Z)",
    );
    expect(screen.getByLabelText("重做").closest("span")?.getAttribute("title")).toBe(
      "重做 (⌘⇧Z)",
    );
  });

  it("shows disabled-state tooltip when undo/redo are unavailable", () => {
    mockTemporal(0, 0);
    render(<UndoRedo />);
    expect(screen.getByLabelText("撤销").closest("span")?.getAttribute("title")).toBe(
      "暂无可撤销操作",
    );
    expect(screen.getByLabelText("重做").closest("span")?.getAttribute("title")).toBe(
      "暂无可重做操作",
    );
  });
});
