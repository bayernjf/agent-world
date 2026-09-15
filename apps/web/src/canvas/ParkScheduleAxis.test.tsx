import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ParkScheduleAxis from "./ParkScheduleAxis";
import type { ContentPlan } from "../lib/api";

const NOW = 1_000_000_000_000;
const H = 60 * 60 * 1000;

function plan(id: string, at: number, title = `plan-${id}`): ContentPlan {
  return {
    id, graphId: "g1", runId: null, artifactId: null, platform: null,
    title, scheduledAt: at, status: "scheduled", publishedUrl: null, note: null,
    createdAt: NOW, updatedAt: NOW,
  };
}

const factories = [{ id: "g1", name: "Factory A" }];

describe("ParkScheduleAxis (RTS C5)", () => {
  it("shows the empty state when nothing is scheduled", () => {
    render(<ParkScheduleAxis plans={[]} factories={factories} cronState={{}} now={NOW} />);
    expect(screen.getByTestId("park-schedule").className).toContain("park-schedule--empty");
  });

  it("renders an in-window plan but hides one beyond 24h", () => {
    render(
      <ParkScheduleAxis
        plans={[plan("near", NOW + 2 * H), plan("far", NOW + 30 * H)]}
        factories={factories}
        cronState={{}}
        now={NOW}
      />,
    );
    expect(screen.getByText("plan-near")).toBeTruthy();
    expect(screen.queryByText("plan-far")).toBeNull();
  });

  it("renders cron ticks as read-only (disabled buttons)", () => {
    render(
      <ParkScheduleAxis
        plans={[]}
        factories={factories}
        cronState={{ g1: { hasCron: true, enabled: true, nextAt: NOW + 3 * H } }}
        now={NOW}
      />,
    );
    const cron = screen.getByTitle(/运行|Run/);
    expect(cron.getAttribute("disabled")).toBeDefined();
  });

  it("hides a paused cron (enabled=false / nextAt=null)", () => {
    render(
      <ParkScheduleAxis
        plans={[]}
        factories={factories}
        cronState={{ g1: { hasCron: true, enabled: false, nextAt: null } }}
        now={NOW}
      />,
    );
    expect(screen.getByTestId("park-schedule").className).toContain("park-schedule--empty");
  });

  it("reschedules a plan by +1h and +24h via the action row", () => {
    const onReschedule = vi.fn();
    render(
      <ParkScheduleAxis
        plans={[plan("p1", NOW + 2 * H)]}
        factories={factories}
        cronState={{}}
        now={NOW}
        onReschedule={onReschedule}
      />,
    );
    // select the plan tick, then choose +1h
    fireEvent.click(screen.getByText("plan-p1"));
    const actions = screen.getByTestId("park-schedule-actions");
    fireEvent.click(screen.getByText(/延后 1 小时|Push \+1h/));
    expect(onReschedule).toHaveBeenCalledWith("p1", NOW + 3 * H);
    expect(actions).toBeTruthy();
  });

  it("offers +24h push", () => {
    const onReschedule = vi.fn();
    render(
      <ParkScheduleAxis
        plans={[plan("p2", NOW + H)]}
        factories={factories}
        cronState={{}}
        now={NOW}
        onReschedule={onReschedule}
      />,
    );
    fireEvent.click(screen.getByText("plan-p2"));
    fireEvent.click(screen.getByText(/明天|tomorrow/i));
    expect(onReschedule).toHaveBeenCalledWith("p2", NOW + 25 * H);
  });
});
