import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphAnnouncementBar, useTemplateAlerts } from "./AnnouncementAlerts";
import type { TargetedAnnouncement } from "./AnnouncementAlerts";

const ann = (over: Partial<TargetedAnnouncement>): TargetedAnnouncement => ({
  id: "a1",
  level: "info",
  titleZh: "公告标题",
  titleEn: "Notice title",
  target: null,
  ...over,
});

function mockAnnouncements(items: TargetedAnnouncement[]) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ items }),
  } as any);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("GraphAnnouncementBar (P3 targeting)", () => {
  it("shows the announcement while the targeted graph is open", async () => {
    mockAnnouncements([
      ann({ id: "g1", target: "graph:g-current", titleZh: "本产线已迁移" }),
    ]);
    render(<GraphAnnouncementBar graphId="g-current" />);
    await waitFor(() => {
      expect(screen.getByText("本产线已迁移")).toBeInTheDocument();
    });
    expect(screen.getByText("本产线公告：")).toBeInTheDocument();
  });

  it("renders nothing when no announcement targets the current graph", async () => {
    mockAnnouncements([
      ann({ id: "g1", target: "graph:g-other" }),
      ann({ id: "t1", target: "template:tpl-x" }),
      ann({ id: "global" }),
    ]);
    const { container } = render(<GraphAnnouncementBar graphId="g-current" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    // Give the state update a tick, then assert nothing rendered.
    await waitFor(() => expect(container.querySelector(".announcements__banner--graph")).toBeNull());
  });

  it("dismiss hides the bar until the component remounts", async () => {
    mockAnnouncements([ann({ id: "g1", target: "graph:g-current", titleZh: "迁移通知" })]);
    render(<GraphAnnouncementBar graphId="g-current" />);
    await waitFor(() => {
      expect(screen.getByText("迁移通知")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    await waitFor(() => {
      expect(screen.queryByText("迁移通知")).toBeNull();
    });
  });
});

describe("useTemplateAlerts (P3 targeting)", () => {
  function Harness() {
    const alerts = useTemplateAlerts();
    return (
      <div data-testid="harness">
        {Object.entries(alerts)
          .map(([id, title]) => `${id}=${title}`)
          .join(",")}
      </div>
    );
  }

  it("maps each targeted template to its announcement title (zh locale)", async () => {
    mockAnnouncements([
      ann({ id: "n1", target: "template:tpl-a", titleZh: "模板 A 公告" }),
      ann({ id: "n2", target: "template:tpl-b", titleZh: "模板 B 公告" }),
      ann({ id: "g1", target: "graph:g-1" }),
      ann({ id: "global" }),
    ]);
    render(<Harness />);
    await waitFor(() => {
      expect(screen.getByTestId("harness")).toHaveTextContent("tpl-a=模板 A 公告,tpl-b=模板 B 公告");
    });
  });

  it("keeps the newest announcement per template (server order)", async () => {
    mockAnnouncements([
      ann({ id: "new", target: "template:tpl-a", titleZh: "新公告" }),
      ann({ id: "old", target: "template:tpl-a", titleZh: "旧公告" }),
    ]);
    render(<Harness />);
    await waitFor(() => {
      expect(screen.getByTestId("harness")).toHaveTextContent("tpl-a=新公告");
    });
  });

  it("yields no alerts when the fetch fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    render(<Harness />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByTestId("harness")).toHaveTextContent("");
    });
  });
});
