import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PendingReview } from "../lib/api";
import { approveDecision } from "./FactoryReviewCard";

const listPendingReviews = vi.fn();
const decideReviews = vi.fn();
vi.mock("../lib/api", () => ({
  api: {
    listPendingReviews: (...a: unknown[]) => listPendingReviews(...a),
    decideReviews: (...a: unknown[]) => decideReviews(...a),
  },
}));

import FactoryReviewCard from "./FactoryReviewCard";

function review(over: Partial<PendingReview> = {}): PendingReview {
  return {
    runId: "r1", graphId: "g1", graphName: "G", nodeId: "n1", nodeName: "审核",
    kind: "human", reason: null, content: null, contentTruncated: false, detail: null,
    tool: null, startedAt: 1, haltedAt: 2, waitingMs: 1000, trigger: "cron", abGroup: null, abArm: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("approveDecision (RTS C7)", () => {
  it("continues a human/gate halt", () => {
    expect(approveDecision(review({ kind: "human" }))).toEqual({ runId: "r1", action: "continue" });
  });
  it("approves a tool halt with the named tool", () => {
    expect(approveDecision(review({ kind: "tool", tool: "bash" }))).toEqual({
      runId: "r1", action: "approve", approveTools: ["bash"],
    });
  });
});

describe("FactoryReviewCard", () => {
  it("shows the empty state when nothing is pending", async () => {
    listPendingReviews.mockResolvedValue({ reviews: [], total: 0 });
    render(<FactoryReviewCard graphId="g1" />);
    await waitFor(() => expect(screen.queryByText(/无待审批|Nothing to review/)).toBeTruthy());
  });

  it("approves a tool halt and removes it locally", async () => {
    listPendingReviews.mockResolvedValue({
      reviews: [review({ kind: "tool", tool: "bash", reason: "run command" })],
      total: 1,
    });
    decideReviews.mockResolvedValue({ ok: true, results: [{ runId: "r1", ok: true, action: "approve" }] });
    const onDecided = vi.fn();
    render(<FactoryReviewCard graphId="g1" onDecided={onDecided} />);

    await waitFor(() => expect(screen.getByTestId("park-review")).toBeTruthy());
    fireEvent.click(screen.getByText(/通过|Approve/));
    await waitFor(() => expect(decideReviews).toHaveBeenCalledTimes(1));
    expect(decideReviews).toHaveBeenCalledWith([{ runId: "r1", action: "approve", approveTools: ["bash"] }]);
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
  });

  it("rejects with action=reject", async () => {
    listPendingReviews.mockResolvedValue({ reviews: [review()], total: 1 });
    decideReviews.mockResolvedValue({ ok: true, results: [{ runId: "r1", ok: true, action: "reject" }] });
    render(<FactoryReviewCard graphId="g1" />);

    await waitFor(() => expect(screen.getByTestId("park-review")).toBeTruthy());
    fireEvent.click(screen.getByText(/驳回|Reject/));
    await waitFor(() =>
      expect(decideReviews).toHaveBeenCalledWith([{ runId: "r1", action: "reject" }]),
    );
  });
});
