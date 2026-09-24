import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api, type RunTimelineResponse } from "../lib/api";
import RunTimelineView from "./RunTimelineView";

vi.mock("../lib/api", () => ({
  api: {
    getRunTimeline: vi.fn(),
    getRunNodeOutput: vi.fn(),
    forkRun: vi.fn(),
    resumeRun: vi.fn(),
  },
}));

const mockGet = api.getRunTimeline as unknown as ReturnType<typeof vi.fn>;
const mockGetNodeOutput = api.getRunNodeOutput as unknown as ReturnType<typeof vi.fn>;
const mockFork = api.forkRun as unknown as ReturnType<typeof vi.fn>;
const mockResume = api.resumeRun as unknown as ReturnType<typeof vi.fn>;

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

/**
 * G4: build a halted run with one degraded video node. By default the remote
 * job is still open (reattach / accept-degraded); `lost` flips it to
 * REMOTE_JOB_LOST (resubmit only), `accepted` marks an already-accepted node.
 */
function degradedSample(
  over: {
    lost?: boolean;
    accepted?: boolean;
    runStatus?: RunTimelineResponse["run"]["status"];
  } = {},
): RunTimelineResponse {
  const degradedAttempt = attempt({
    status: "degraded",
    durationMs: null,
    startedAt: null,
    finishedAt: null,
    degradedReason: over.lost
      ? "remote job no longer found by the provider"
      : "video poll window closed while the render continues remotely",
    errorCode: over.lost ? "REMOTE_JOB_LOST" : null,
    error: over.lost ? "remote job no longer found by the provider" : null,
    remoteJob: over.lost ? null : { kind: "video", jobId: "job-123" },
    degradedAccepted: over.accepted ?? false,
  });
  return {
    ...sample,
    run: {
      ...sample.run,
      status: over.runStatus ?? "halted",
      haltedNodeId: "V",
      haltedReason: null,
    },
    nodeMeta: { V: { name: "视频生成", kind: "videoGen" } },
    timeline: {
      ...sample.timeline,
      nodes: [{ nodeId: "V", status: "degraded", attempts: [degradedAttempt] }],
      totals: {
        nodes: 1,
        done: 0,
        failed: 0,
        skipped: 0,
        attempts: 1,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      },
    },
  };
}

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

  describe("degraded long-task recovery (G4)", () => {
    beforeEach(() => {
      mockResume.mockReset();
      mockResume.mockResolvedValue({ ok: true });
    });

    it("renders an open degraded node with reason, job handle and both actions", async () => {
      mockGet.mockResolvedValue(degradedSample());
      render(<RunTimelineView runId="run-1" />);

      await screen.findByText("视频生成");
      // Orange degraded badge on both the node header and the attempt row.
      expect(document.querySelectorAll(".run-status--degraded").length).toBeGreaterThan(0);
      expect(screen.getByText("降级原因：")).toBeTruthy();
      expect(screen.getByText(/video poll window closed/)).toBeTruthy();
      // Label and job id share one inline span.
      const jobHandle = screen.getByText(/任务 ID/);
      expect(jobHandle.textContent).toContain("job-123");
      expect(jobHandle.getAttribute("title")).toBe("job-123");
      // Open job → reattach + accept-degraded, no resubmit.
      expect(screen.getByRole("button", { name: "继续此节点" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "接受降级结果" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /重新提交/ })).toBeNull();
    });

    it("reattaches immediately and calls resumeRun with the reattach action", async () => {
      mockGet.mockResolvedValue(degradedSample());
      render(<RunTimelineView runId="run-1" />);

      await screen.findByText("视频生成");
      fireEvent.click(screen.getByRole("button", { name: "继续此节点" }));
      await waitFor(() =>
        expect(mockResume).toHaveBeenCalledWith("run-1", "reattach"),
      );
    });

    it("requires a second confirmation before accepting the degraded result", async () => {
      mockGet.mockResolvedValue(degradedSample());
      render(<RunTimelineView runId="run-1" />);

      await screen.findByText("视频生成");
      // Confirmation is not shown initially.
      expect(
        screen.queryByText("该节点没有产出，下游可能因缺素材失败，确定放行？"),
      ).toBeNull();

      // First click arms the confirm row; no API call yet.
      fireEvent.click(screen.getByRole("button", { name: "接受降级结果" }));
      expect(
        screen.getByText("该节点没有产出，下游可能因缺素材失败，确定放行？"),
      ).toBeTruthy();
      expect(mockResume).not.toHaveBeenCalled();

      // Cancel disarms the confirm row.
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      expect(screen.queryByRole("button", { name: "确定放行" })).toBeNull();

      // Re-arm and confirm → accept-degraded action fires.
      fireEvent.click(screen.getByRole("button", { name: "接受降级结果" }));
      fireEvent.click(screen.getByRole("button", { name: "确定放行" }));
      await waitFor(() =>
        expect(mockResume).toHaveBeenCalledWith("run-1", "accept-degraded"),
      );
    });

    it("offers only resubmit (which bills again) when the remote job was lost", async () => {
      mockGet.mockResolvedValue(degradedSample({ lost: true }));
      render(<RunTimelineView runId="run-1" />);

      await screen.findByText("视频生成");
      expect(screen.queryByRole("button", { name: "继续此节点" })).toBeNull();
      expect(screen.queryByRole("button", { name: "接受降级结果" })).toBeNull();

      const resubmit = screen.getByRole("button", { name: /重新提交/ });
      fireEvent.click(resubmit);
      // Resubmit maps to a plain "continue" resume reset from the lost node.
      await waitFor(() =>
        expect(mockResume).toHaveBeenCalledWith("run-1", "continue", "V"),
      );
    });

    it("hides the decision actions once the run is no longer halted", async () => {
      mockGet.mockResolvedValue(degradedSample({ runStatus: "done" }));
      render(<RunTimelineView runId="run-1" />);

      await screen.findByText("视频生成");
      expect(screen.queryByRole("button", { name: "继续此节点" })).toBeNull();
      expect(screen.queryByRole("button", { name: /重新提交/ })).toBeNull();
    });

    it("shows the accepted-degraded marker after an operator accepts the result", async () => {
      mockGet.mockResolvedValue(degradedSample({ accepted: true }));
      render(<RunTimelineView runId="run-1" />);

      await screen.findByText("视频生成");
      expect(
        screen.getByText("已接受降级结果，run 继续，该节点保留降级标记"),
      ).toBeTruthy();
    });
  });
});
