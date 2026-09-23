import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api, type RunTimelineResponse } from "../lib/api";
import RunTimelineView from "./RunTimelineView";

vi.mock("../lib/api", () => ({
  api: {
    getRunTimeline: vi.fn(),
    getRunNodeOutput: vi.fn(),
    forkRun: vi.fn(),
  },
}));

const mockGet = api.getRunTimeline as unknown as ReturnType<typeof vi.fn>;
const mockGetNodeOutput = api.getRunNodeOutput as unknown as ReturnType<typeof vi.fn>;
const mockFork = api.forkRun as unknown as ReturnType<typeof vi.fn>;

function attempt(over: Record<string, unknown> = {}) {
  return {
    attempt: 1,
    variant: "main",
    status: "done",
    startedAt: 1000,
    finishedAt: 2000,
    durationMs: 1000,
    outputPreview: "",
    outputTruncated: false,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    model: null,
    score: null,
    gate: null,
    error: null,
    errorCode: null,
    skipReason: null,
    toolCalls: 0,
    artifacts: 0,
    ...over,
  };
}

const sample: RunTimelineResponse = {
  run: {
    id: "run-1",
    graphId: "g1",
    status: "failed",
    trigger: "cron",
    startedAt: 1000,
    endedAt: 3000,
    budgetUsd: 0.5,
    haltedNodeId: null,
    haltedReason: null,
    input: "",
  },
  nodeMeta: {
    A: { name: "写草稿", kind: "textGen" },
    B: { name: "质检站", kind: "gate" },
  },
  timeline: {
    nodes: [
      {
        nodeId: "A",
        status: "done",
        attempts: [
          attempt({
            outputPreview: "hello world",
            outputTruncated: true,
            tokensIn: 10,
            tokensOut: 5,
            costUsd: 0.01,
            model: "agnes-1",
            artifacts: 1,
          }),
        ],
      },
      {
        nodeId: "B",
        status: "failed",
        attempts: [
          attempt({
            attempt: 1,
            status: "failed",
            error: "rate limited",
            errorCode: "RATE_LIMIT",
            durationMs: 200,
          }),
          attempt({
            attempt: 2,
            status: "failed",
            error: "rate limited again",
            errorCode: "RATE_LIMIT",
            durationMs: 300,
          }),
        ],
      },
    ],
    totals: {
      nodes: 2,
      done: 1,
      failed: 1,
      skipped: 0,
      attempts: 3,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.01,
    },
    budget: {
      budgetUsd: 0.5,
      totalCostUsd: 0.01,
      remainingUsd: 0.49,
      tripped: false,
      warning: false,
    },
  },
};

describe("RunTimelineView", () => {
  it("renders node names, attempts, output and error codes", async () => {
    mockGet.mockResolvedValue(sample);
    render(<RunTimelineView runId="run-1" />);

    await waitFor(() => expect(screen.getByText("写草稿")).toBeTruthy());
    expect(screen.getByText("质检站")).toBeTruthy();
    expect(screen.getByText(/hello world/)).toBeTruthy();
    expect(screen.getAllByText("RATE_LIMIT").length).toBe(2);
    expect(screen.getByText("agnes-1")).toBeTruthy();
    // $0.0100 appears once in the attempt metric and once in the totals summary.
    expect(screen.getAllByText("$0.0100").length).toBe(2);
  });

  it("shows an error message when the request fails", async () => {
    mockGet.mockRejectedValue(new Error("network"));
    render(<RunTimelineView runId="run-x" />);
    await waitFor(() =>
      expect(document.querySelector(".run-timeline-error")).toBeTruthy(),
    );
  });

  it("lazy-loads and reveals the full output when the toggle is clicked", async () => {
    mockGet.mockResolvedValue(sample);
    mockGetNodeOutput.mockResolvedValue({
      nodeId: "A",
      attempt: 1,
      variant: "main",
      output: `FULL LONG OUTPUT${"!".repeat(40)}`,
    });
    const { container } = render(<RunTimelineView runId="run-1" />);

    await screen.findByText(/hello world/);
    const toggle = container.querySelector(".run-timeline-output-toggle");
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle as HTMLElement);

    await waitFor(() =>
      expect(container.querySelector(".run-timeline-output--full")).toBeTruthy(),
    );
    expect(screen.getByText(/FULL LONG OUTPUT/)).toBeTruthy();
    expect(mockGetNodeOutput).toHaveBeenCalledWith("run-1", "A", 1);
  });

  it("shows an inline error if loading the full output fails", async () => {
    mockGet.mockResolvedValue(sample);
    mockGetNodeOutput.mockRejectedValue(new Error("boom"));
    const { container } = render(<RunTimelineView runId="run-1" />);

    await screen.findByText(/hello world/);
    fireEvent.click(
      container.querySelector(".run-timeline-output-toggle") as HTMLElement,
    );
    await waitFor(() =>
      expect(container.querySelector(".run-timeline-output-error")).toBeTruthy(),
    );
  });

  it("offers 'rerun from here' only on succeeded nodes and calls forkRun", async () => {
    mockGet.mockResolvedValue(sample);
    mockFork.mockResolvedValue({ runId: "new-run" });
    const onForked = vi.fn();
    render(<RunTimelineView runId="run-1" onForked={onForked} />);

    await screen.findByText(/hello world/);
    // A is done → one fork button; B failed → no fork button.
    const forkButtons = screen.getAllByRole("button", { name: "从此处重跑" });
    expect(forkButtons).toHaveLength(1);

    fireEvent.click(forkButtons[0]!);
    await waitFor(() => expect(mockFork).toHaveBeenCalledWith("run-1", "A"));
    await waitFor(() => expect(onForked).toHaveBeenCalledWith("new-run"));
  });

  it("shows an inline error when forking fails", async () => {
    mockGet.mockResolvedValue(sample);
    mockFork.mockRejectedValue(new Error("422 boom"));
    const { container } = render(<RunTimelineView runId="run-1" />);

    await screen.findByText(/hello world/);
    fireEvent.click(screen.getByRole("button", { name: "从此处重跑" }));
    await waitFor(() =>
      expect(container.querySelector(".run-timeline-forkerror")).toBeTruthy(),
    );
    expect(container.querySelector(".run-timeline-forkerror")?.textContent).toContain("422 boom");
  });

  it("marks reused upstream nodes with a reused badge", async () => {
    const reusedSample: RunTimelineResponse = {
      ...sample,
      timeline: {
        ...sample.timeline,
        nodes: [
          { ...sample.timeline.nodes[0]!, reused: true },
          sample.timeline.nodes[1]!,
        ],
      },
    };
    mockGet.mockResolvedValue(reusedSample);
    render(<RunTimelineView runId="run-1" />);
    await screen.findByText("复用");
  });

  it("shows the skip reason for skipped nodes", async () => {
    const skippedSample: RunTimelineResponse = {
      ...sample,
      nodeMeta: { ...sample.nodeMeta, C: { name: "配音", kind: "audioGen" } },
      timeline: {
        ...sample.timeline,
        nodes: [
          ...sample.timeline.nodes,
          {
            nodeId: "C",
            status: "skipped",
            attempts: [
              attempt({
                status: "skipped",
                durationMs: null,
                skipReason: "audio unsupported: worker has no generateAudio capability",
              }),
            ],
          },
        ],
        totals: { ...sample.timeline.totals, nodes: 3, skipped: 1 },
      },
    };
    mockGet.mockResolvedValue(skippedSample);
    render(<RunTimelineView runId="run-1" />);
    await screen.findByText("配音");
    expect(screen.getByText("跳过原因：")).toBeTruthy();
    expect(
      screen.getByText("audio unsupported: worker has no generateAudio capability"),
    ).toBeTruthy();
  });
});
