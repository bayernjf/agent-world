import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import AnnouncementBell, { type AnnouncementItem } from "./AnnouncementBell";

// The management panel has its own data flow; isolate it here.
vi.mock("./AnnouncementManager", () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>管理面板</div> : null),
}));

const NOW = 1_700_000_000_000;

function mkAnn(over: Partial<AnnouncementItem> = {}): AnnouncementItem {
  return {
    id: "a-1",
    level: "info",
    startsAt: NOW - 1000,
    endsAt: null,
    createdAt: NOW,
    titleZh: "中文标题",
    titleEn: "English title",
    bodyZh: "中文正文",
    bodyEn: "English body",
    read: false,
    ...over,
  };
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/** Route fetch: /auth/me for the role gate, /read for marking, list otherwise. */
function mockFetch(items: AnnouncementItem[], canManage = false): ReturnType<typeof vi.fn> {
  return vi.fn(((url: string) => {
    const u = String(url);
    if (u.includes("/auth/me")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ user: { canManageAnnouncements: canManage } }),
      });
    }
    if (u.endsWith("/read")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) });
  }) as FetchImpl);
}

async function renderBell(items: AnnouncementItem[], canManage = false) {
  global.fetch = mockFetch(items, canManage) as unknown as typeof fetch;
  render(<AnnouncementBell />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await act(async () => {});
}

function bellButton(): HTMLButtonElement {
  return screen.getByText("公告").closest("button") as HTMLButtonElement;
}

describe("AnnouncementBell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the bell with no unread badge when all read", async () => {
    await renderBell([mkAnn({ read: true })]);
    expect(document.querySelector(".chip__badge")).toBeNull();
  });

  it("shows an unread count badge", async () => {
    await renderBell([mkAnn({ id: "a-1" }), mkAnn({ id: "a-2" })]);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("opens the popover and lists announcement titles", async () => {
    await renderBell([mkAnn()]);
    expect(screen.queryByText("中文标题")).not.toBeInTheDocument();
    fireEvent.click(bellButton());
    expect(screen.getByText("中文标题")).toBeInTheDocument();
  });

  it("shows an empty state in the popover when there are no items", async () => {
    await renderBell([]);
    fireEvent.click(bellButton());
    expect(screen.getByText("暂无公告")).toBeInTheDocument();
  });

  it("opens the detail modal and marks the item read", async () => {
    await renderBell([mkAnn()]);
    fireEvent.click(bellButton());
    fireEvent.click(screen.getByText("中文标题"));
    // body shown
    expect(screen.getByText("中文正文")).toBeInTheDocument();
    // read endpoint called
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/announcements/a-1/read"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
    // badge cleared after read
    await act(async () => {});
    expect(document.querySelector(".chip__badge")).toBeNull();
  });

  it("shows the no-body placeholder when an announcement has no body", async () => {
    await renderBell([mkAnn({ bodyZh: null, bodyEn: null })]);
    fireEvent.click(bellButton());
    fireEvent.click(screen.getByText("中文标题"));
    expect(screen.getByText("（无正文）")).toBeInTheDocument();
  });

  it("closes the detail modal via its close button", async () => {
    await renderBell([mkAnn()]);
    fireEvent.click(bellButton());
    fireEvent.click(screen.getByText("中文标题"));
    fireEvent.click(screen.getByText("关闭"));
    await act(async () => {});
    expect(screen.queryByText("中文正文")).not.toBeInTheDocument();
  });

  it("renders a dismissable warning banner and marks it read", async () => {
    await renderBell([mkAnn({ id: "w-1", level: "warning", titleZh: "警告标题" })]);
    expect(screen.getByText("警告标题")).toBeInTheDocument();
    fireEvent.click(screen.getByText("知道了"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/announcements/w-1/read"),
        expect.any(Object),
      ),
    );
    await act(async () => {});
    expect(screen.queryByText("警告标题")).not.toBeInTheDocument();
  });

  it("forces a critical modal until acknowledged, then marks read", async () => {
    await renderBell([mkAnn({ id: "c-1", level: "critical", titleZh: "紧急标题", bodyZh: "紧急正文" })]);
    // modal visible before acknowledgement
    expect(screen.getByText("紧急正文")).toBeInTheDocument();
    fireEvent.click(screen.getByText("我已知晓"));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/announcements/c-1/read"),
        expect.any(Object),
      ),
    );
    await act(async () => {});
    expect(screen.queryByText("紧急正文")).not.toBeInTheDocument();
  });

  it("shows the manage action only for users who can manage", async () => {
    await renderBell([mkAnn()], true);
    fireEvent.click(bellButton());
    expect(screen.getByText("管理公告")).toBeInTheDocument();
  });

  it("hides the manage action for ordinary users", async () => {
    await renderBell([mkAnn()], false);
    fireEvent.click(bellButton());
    expect(screen.queryByText("管理公告")).not.toBeInTheDocument();
  });

  it("toggles the popover closed when clicking the bell again and on Escape", async () => {
    await renderBell([mkAnn()]);
    const bell = bellButton();
    fireEvent.click(bell);
    expect(screen.getByText("中文标题")).toBeInTheDocument();
    fireEvent.click(bell);
    expect(screen.queryByText("中文标题")).not.toBeInTheDocument();
    // reopen and close via Escape
    fireEvent.click(bell);
    expect(screen.getByText("中文标题")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("中文标题")).not.toBeInTheDocument();
  });
});
