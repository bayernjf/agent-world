import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphAnnouncementBar, GlobalAnnouncementBar, useTemplateAlerts } from "./AnnouncementAlerts";
import type { TargetedAnnouncement } from "./AnnouncementAlerts";

const ann = (over: Partial<TargetedAnnouncement>): TargetedAnnouncement => ({
  id: "a1",
  level: "info",
  titleZh: "公告标题",
  titleEn: "Notice title",
  bodyZh: null,
  bodyEn: null,
  target: null,
  read: false,
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

describe("GlobalAnnouncementBar (全员公告卡片)", () => {
  it("renders the unread global warning with its body", async () => {
    mockAnnouncements([
      ann({
        id: "w1",
        level: "warning",
        titleZh: "内置模型 Token 已用尽",
        bodyZh: "可在设置中改用自带模型（BYOK）。",
      }),
    ]);
    render(<GlobalAnnouncementBar />);
    await waitFor(() => {
      expect(screen.getByText("内置模型 Token 已用尽")).toBeInTheDocument();
    });
    expect(screen.getByText("可在设置中改用自带模型（BYOK）。")).toBeInTheDocument();
    expect(screen.getByText("平台公告：")).toBeInTheDocument();
    expect(
      document.querySelector(".announcements__banner--warning"),
    ).toBeInTheDocument();
  });

  it("ignores read, info and targeted announcements", async () => {
    mockAnnouncements([
      ann({ id: "read", level: "warning", read: true }),
      ann({ id: "info", level: "info" }),
      ann({ id: "graph", level: "warning", target: "graph:g-1" }),
      ann({ id: "tpl", level: "warning", target: "template:tpl-1" }),
    ]);
    const { container } = render(<GlobalAnnouncementBar />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await act(async () => {});
    expect(container.querySelector(".announcements__banner")).toBeNull();
  });

  it("still renders a per-user announcement (usage alerts target user:<id>)", async () => {
    mockAnnouncements([
      ann({ id: "u1", level: "warning", target: "user:me", titleZh: "内置模型 Token 已用尽" }),
    ]);
    render(<GlobalAnnouncementBar />);
    await waitFor(() => {
      expect(screen.getByText("内置模型 Token 已用尽")).toBeInTheDocument();
    });
  });

  it("dismiss posts the read flag and hides the card", async () => {
    mockAnnouncements([ann({ id: "w1", level: "warning", titleZh: "警告标题" })]);
    render(<GlobalAnnouncementBar />);
    await waitFor(() => {
      expect(screen.getByText("警告标题")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/announcements/w1/read"),
        expect.any(Object),
      ),
    );
    await waitFor(() => expect(screen.queryByText("警告标题")).toBeNull());
  });
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
    await waitFor(() => expect(container.querySelector(".announcements__banner")).toBeNull());
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
