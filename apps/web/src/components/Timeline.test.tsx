import { render, screen, fireEvent } from "@testing-library/react";
import Timeline from "./Timeline";

// Mock useRun store
const mockScrubTo = vi.fn();
const mockReset = vi.fn();
vi.mock("../store/run", () => ({
  useRun: vi.fn(),
}));

// Mock Tooltip
vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

import { useRun } from "../store/run";
const mockUseRun = useRun as unknown as ReturnType<typeof vi.fn>;

const sampleEvents = [
  { seq: 0, type: "run.started", ts: 1000 },
  { seq: 1, type: "node.started", ts: 1001, nodeId: "n1" },
  { seq: 2, type: "node.delta", ts: 1002, nodeId: "n1" },
  { seq: 3, type: "node.finished", ts: 1003, nodeId: "n1" },
  { seq: 4, type: "run.finished", ts: 1004 },
];

function setupMocks(overrides: Partial<ReturnType<typeof useRun>> = {}) {
  mockUseRun.mockReturnValue({
    events: sampleEvents,
    scrubSeq: null,
    scrubTo: mockScrubTo,
    view: "live",
    reset: mockReset,
    ...overrides,
  });
}

function renderComponent() {
  render(<Timeline />);
}

describe("Timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  describe("渲染", () => {
    it("events 为空时返回 null", () => {
      setupMocks({ events: [] });
      const { container } = render(<Timeline />);
      expect(container.firstChild).toBeNull();
    });

    it("显示'回放'标签", () => {
      renderComponent();
      expect(screen.getByText("回放")).toBeInTheDocument();
    });

    it("显示当前 seq / 最大 seq", () => {
      renderComponent();
      expect(screen.getByText(/seq 4 \/ 4/)).toBeInTheDocument();
    });

    it("显示当前事件类型标签", () => {
      renderComponent();
      expect(screen.getByText(/收工/)).toBeInTheDocument();
    });

    it("渲染滑块", () => {
      renderComponent();
      const slider = screen.getByRole("slider");
      expect(slider).toBeInTheDocument();
      expect(slider).toHaveAttribute("min", "0");
      expect(slider).toHaveAttribute("max", "4");
    });

    it("有 timeline panel class", () => {
      renderComponent();
      expect(document.querySelector(".timeline")).toBeInTheDocument();
    });
  });

  describe("事件标签映射", () => {
    it("run.started 显示'开工'", () => {
      setupMocks({ scrubSeq: 0 });
      renderComponent();
      expect(screen.getByText(/开工/)).toBeInTheDocument();
    });

    it("node.started 显示'开始作业'", () => {
      setupMocks({ scrubSeq: 1 });
      renderComponent();
      expect(screen.getByText(/开始作业/)).toBeInTheDocument();
    });

    it("node.delta 显示'产出流入'", () => {
      setupMocks({ scrubSeq: 2 });
      renderComponent();
      expect(screen.getByText(/产出流入/)).toBeInTheDocument();
    });

    it("node.finished 显示'作业完成'", () => {
      setupMocks({ scrubSeq: 3 });
      renderComponent();
      expect(screen.getByText(/作业完成/)).toBeInTheDocument();
    });

    it("run.finished 显示'收工'", () => {
      setupMocks({ scrubSeq: 4 });
      renderComponent();
      expect(screen.getByText(/收工/)).toBeInTheDocument();
    });

    it("未知事件类型显示原始 type", () => {
      const events = [{ seq: 0, type: "unknown.event", ts: 1000 }];
      setupMocks({ events });
      renderComponent();
      expect(screen.getByText(/unknown\.event/)).toBeInTheDocument();
    });
  });

  describe("scrub 状态", () => {
    it("scrubSeq 不为 null 时显示当前 seq", () => {
      setupMocks({ scrubSeq: 2 });
      renderComponent();
      expect(screen.getByText(/seq 2 \/ 4/)).toBeInTheDocument();
    });

    it("scrubSeq 不为 null 时显示'回到实时'按钮", () => {
      setupMocks({ scrubSeq: 2 });
      renderComponent();
      expect(screen.getByText("回到实时")).toBeInTheDocument();
    });

    it("scrubSeq 为 null 时不显示'回到实时'按钮", () => {
      setupMocks({ scrubSeq: null });
      renderComponent();
      expect(screen.queryByText("回到实时")).not.toBeInTheDocument();
    });

    it("点击'回到实时'调用 scrubTo(null)", () => {
      setupMocks({ scrubSeq: 2 });
      renderComponent();
      fireEvent.click(screen.getByText("回到实时"));
      expect(mockScrubTo).toHaveBeenCalledWith(null);
    });
  });

  describe("回放视图", () => {
    it("view=replay 且 scrubSeq=null 时显示'退出回放'按钮", () => {
      setupMocks({ view: "replay", scrubSeq: null });
      renderComponent();
      expect(screen.getByText("退出回放")).toBeInTheDocument();
    });

    it("view=replay 且 scrubSeq!=null 时不显示'退出回放'按钮", () => {
      setupMocks({ view: "replay", scrubSeq: 2 });
      renderComponent();
      expect(screen.queryByText("退出回放")).not.toBeInTheDocument();
    });

    it("view=live 时不显示'退出回放'按钮", () => {
      setupMocks({ view: "live", scrubSeq: null });
      renderComponent();
      expect(screen.queryByText("退出回放")).not.toBeInTheDocument();
    });

    it("点击'退出回放'调用 reset", () => {
      setupMocks({ view: "replay", scrubSeq: null });
      renderComponent();
      fireEvent.click(screen.getByText("退出回放"));
      expect(mockReset).toHaveBeenCalledTimes(1);
    });
  });

  describe("滑块交互", () => {
    it("拖动滑块调用 scrubTo", () => {
      renderComponent();
      const slider = screen.getByRole("slider");
      fireEvent.change(slider, { target: { value: "2" } });
      expect(mockScrubTo).toHaveBeenCalledWith(2);
    });

    it("滑块拖到最大值时调用 scrubTo(null)", () => {
      setupMocks({ scrubSeq: 0 });
      renderComponent();
      const slider = screen.getByRole("slider");
      fireEvent.change(slider, { target: { value: "4" } });
      expect(mockScrubTo).toHaveBeenCalledWith(null);
    });

    it("滑块拖到 0 时调用 scrubTo(0)", () => {
      renderComponent();
      const slider = screen.getByRole("slider");
      fireEvent.change(slider, { target: { value: "0" } });
      expect(mockScrubTo).toHaveBeenCalledWith(0);
    });
  });
});
