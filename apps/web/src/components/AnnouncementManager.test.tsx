import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AnnouncementManager, {
  type ManageAnnouncement,
} from "./AnnouncementManager";

const baseItem = (over: Partial<ManageAnnouncement>): ManageAnnouncement => ({
  id: "a1",
  level: "info",
  startsAt: Date.now() - 1000,
  endsAt: null,
  createdAt: Date.now(),
  titleZh: "标题",
  titleEn: "Title",
  bodyZh: null,
  bodyEn: null,
  target: null,
  ...over,
});

/** Route-aware fetch mock: manage list + PATCH/POST echo bodies. */
function mockFetch(items: ManageAnnouncement[]) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (url === "/api/announcements/manage") {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) } as any);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) } as any);
  });
  return calls;
}

const open = vi.fn();
const onChanged = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AnnouncementManager target form (P3)", () => {
  it("labels targeted rows in the list and leaves global rows bare", async () => {
    mockFetch([
      baseItem({ id: "t1", target: "template:tpl-fake" }),
      baseItem({ id: "g1", target: "graph:g-abcdefghijklmnop" }),
      baseItem({ id: "all1" }),
    ]);
    render(<AnnouncementManager open onClose={open} onChanged={onChanged} />);
    await waitFor(() => expect(screen.getByText("模板定向 · tpl-fake")).toBeInTheDocument());
    expect(screen.getByText("产线定向 · g-abcdefghij…")).toBeInTheDocument();
  });

  it("round-trips a template target through the edit form", async () => {
    mockFetch([baseItem({ id: "t1", target: "template:tpl-product" })]);
    render(<AnnouncementManager open onClose={open} onChanged={onChanged} />);
    await waitFor(() => screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    // The kind select reads 按模板 and the template select carries the id.
    const kindSelect = screen.getByLabelText(/定向范围/) as HTMLSelectElement;
    expect(kindSelect.value).toBe("template");
    const tplSelect = screen.getByLabelText("选择模板") as HTMLSelectElement;
    expect(tplSelect.value).toBe("tpl-product");
  });

  it("serializes the chosen audience into the PATCH payload", async () => {
    const calls = mockFetch([baseItem({ id: "t1", target: "template:tpl-fake" })]);
    render(<AnnouncementManager open onClose={open} onChanged={onChanged} />);
    await waitFor(() => screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    // Switch to graph targeting and fill the id.
    fireEvent.change(screen.getByLabelText(/定向范围/), { target: { value: "graph" } });
    fireEvent.change(screen.getByLabelText(/产线 ID/), { target: { value: " g-123 " } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      expect(patch).toBeDefined();
      expect(patch!.body.target).toBe("graph:g-123");
    });
  });

  it("sends target null when the audience is 全员", async () => {
    const calls = mockFetch([baseItem({ id: "t1", target: "template:tpl-fake" })]);
    render(<AnnouncementManager open onClose={open} onChanged={onChanged} />);
    await waitFor(() => screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    fireEvent.change(screen.getByLabelText(/定向范围/), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      expect(patch).toBeDefined();
      expect(patch!.body.target).toBeNull();
    });
  });

  it("falls back to 全员 when editing a row with a legacy unknown target", async () => {
    mockFetch([baseItem({ id: "legacy", target: "role:admin" })]);
    render(<AnnouncementManager open onClose={open} onChanged={onChanged} />);
    await waitFor(() => screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    const kindSelect = screen.getByLabelText(/定向范围/) as HTMLSelectElement;
    expect(kindSelect.value).toBe("all");
  });

  it("creates a template-targeted announcement from the new form", async () => {
    const calls = mockFetch([]);
    render(<AnnouncementManager open onClose={open} onChanged={onChanged} />);
    await waitFor(() => screen.getByRole("button", { name: "新建" }));
    fireEvent.click(screen.getByRole("button", { name: "新建" }));

    fireEvent.change(screen.getByLabelText(/定向范围/), { target: { value: "template" } });
    const tplSelect = screen.getByLabelText("选择模板") as HTMLSelectElement;
    const firstOption = within(tplSelect).getAllByRole("option")[1] as HTMLOptionElement;
    fireEvent.change(tplSelect, { target: { value: firstOption.value } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST");
      expect(post).toBeDefined();
      expect(post!.body.target).toBe(`template:${firstOption.value}`);
    });
  });
});
