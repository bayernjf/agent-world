import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { ContentPlan } from "../lib/api";
import CalendarView from "./CalendarView";

vi.mock("../lib/api", () => ({
  api: {
    listPlans: vi.fn(),
    createPlan: vi.fn(),
    updatePlan: vi.fn(),
    deletePlan: vi.fn(),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockListPlans = api.listPlans as unknown as ReturnType<typeof vi.fn>;
const mockCreatePlan = api.createPlan as unknown as ReturnType<typeof vi.fn>;
const mockUpdatePlan = api.updatePlan as unknown as ReturnType<typeof vi.fn>;
const mockDeletePlan = api.deletePlan as unknown as ReturnType<typeof vi.fn>;

/** A timestamp inside the currently-displayed month (whatever "now" is). */
function monthDay(day: number, h = 10, m = 0): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), day, h, m, 0).getTime();
}

function mkPlan(over: Partial<ContentPlan> = {}): ContentPlan {
  return {
    id: "p-1",
    graphId: null,
    runId: null,
    artifactId: null,
    platform: "xiaohongshu",
    title: "种草笔记",
    scheduledAt: monthDay(15),
    status: "scheduled",
    publishedUrl: null,
    note: null,
    createdAt: monthDay(1),
    updatedAt: monthDay(1),
    ...over,
  };
}

function dayButton(dayNum: number): HTMLButtonElement {
  return screen.getByText(String(dayNum)).closest("button") as HTMLButtonElement;
}

async function flush() {
  await act(async () => {});
}

async function renderCalendar(open = true) {
  const onClose = vi.fn();
  render(<CalendarView open={open} onClose={onClose} />);
  if (open) {
    await waitFor(() => expect(mockListPlans).toHaveBeenCalled());
    await flush();
  }
  return { onClose };
}

describe("CalendarView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPlans.mockResolvedValue([]);
    mockCreatePlan.mockResolvedValue(mkPlan({ id: "p-new" }));
    mockUpdatePlan.mockResolvedValue(mkPlan());
    mockDeletePlan.mockResolvedValue(undefined);
  });

  it("renders nothing when closed", () => {
    const { container } = render(<CalendarView open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(mockListPlans).not.toHaveBeenCalled();
  });

  it("renders title, weekday header and month label when open", async () => {
    await renderCalendar();
    expect(screen.getByText("内容日历")).toBeInTheDocument();
    // weekday header 日..六
    for (const w of ["日", "一", "二", "三", "四", "五", "六"]) {
      expect(screen.getByText(w)).toBeInTheDocument();
    }
    const now = new Date();
    expect(screen.getByText(`${now.getFullYear()} / ${now.getMonth() + 1}`)).toBeInTheDocument();
  });

  it("loads plans scoped to the displayed month window", async () => {
    await renderCalendar();
    expect(mockListPlans).toHaveBeenCalledTimes(1);
    const [from, to] = mockListPlans.mock.calls[0];
    const now = new Date();
    expect(from).toBe(new Date(now.getFullYear(), now.getMonth(), 1).getTime());
    expect(to).toBe(new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).getTime());
  });

  it("renders a plan chip on its scheduled day", async () => {
    mockListPlans.mockResolvedValue([mkPlan()]);
    await renderCalendar();
    expect(screen.getByText("种草笔记")).toBeInTheDocument();
  });

  it("opens the add drawer when clicking an empty day", async () => {
    await renderCalendar();
    fireEvent.click(dayButton(20));
    expect(screen.getByText("添加排期")).toBeInTheDocument();
  });

  it("opens the edit drawer (prefilled) when clicking an existing plan chip", async () => {
    mockListPlans.mockResolvedValue([mkPlan()]);
    await renderCalendar();
    fireEvent.click(screen.getByText("种草笔记"));
    expect(screen.getByText("编辑排期")).toBeInTheDocument();
    expect((screen.getByPlaceholderText("如 新品上架种草笔记") as HTMLInputElement).value).toBe(
      "种草笔记",
    );
  });

  it("blocks save with an empty title and does not call createPlan", async () => {
    await renderCalendar();
    fireEvent.click(dayButton(20));
    fireEvent.click(screen.getByText("保存"));
    await flush();
    expect(screen.getByText("请填写标题")).toBeInTheDocument();
    expect(mockCreatePlan).not.toHaveBeenCalled();
  });

  it("creates a plan and closes the drawer", async () => {
    await renderCalendar();
    fireEvent.click(dayButton(20));
    fireEvent.change(screen.getByPlaceholderText("如 新品上架种草笔记"), {
      target: { value: "新排期" },
    });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(mockCreatePlan).toHaveBeenCalledTimes(1));
    const payload = mockCreatePlan.mock.calls[0][0];
    expect(payload.title).toBe("新排期");
    expect(payload.platform).toBe("xiaohongshu");
    // drawer closed after save
    await flush();
    expect(screen.queryByText("添加排期")).not.toBeInTheDocument();
  });

  it("updates an existing plan from the edit drawer", async () => {
    mockListPlans.mockResolvedValue([mkPlan()]);
    await renderCalendar();
    fireEvent.click(screen.getByText("种草笔记"));
    const titleInput = screen.getByPlaceholderText("如 新品上架种草笔记");
    fireEvent.change(titleInput, { target: { value: "改后标题" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(mockUpdatePlan).toHaveBeenCalledWith("p-1", expect.objectContaining({ title: "改后标题" })));
  });

  it("deletes an existing plan from the edit drawer", async () => {
    mockListPlans.mockResolvedValue([mkPlan()]);
    await renderCalendar();
    fireEvent.click(screen.getByText("种草笔记"));
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() => expect(mockDeletePlan).toHaveBeenCalledWith("p-1"));
  });

  it("navigates to the next month and reloads with a new window", async () => {
    await renderCalendar();
    const firstFrom = mockListPlans.mock.calls[0][0];
    const nextBtn = screen.getAllByText("›")[0] as HTMLButtonElement;
    fireEvent.click(nextBtn);
    await waitFor(() => expect(mockListPlans).toHaveBeenCalledTimes(2));
    const secondFrom = mockListPlans.mock.calls[1][0];
    expect(secondFrom).toBeGreaterThan(firstFrom);
  });

  it("closes on Escape", async () => {
    const { onClose } = await renderCalendar();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on backdrop click but not when clicking the modal body", async () => {
    const { onClose } = await renderCalendar();
    const modal = document.querySelector(".modal")!;
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(".modal-backdrop")!);
    expect(onClose).toHaveBeenCalled();
  });
});
