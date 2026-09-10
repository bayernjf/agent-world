import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { PublishTarget } from "../lib/api";
import PublishTargets from "./PublishTargets";

vi.mock("../lib/api", () => ({
  api: {
    listPublishTargets: vi.fn(),
    createPublishTarget: vi.fn(),
    deletePublishTarget: vi.fn(),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockList = api.listPublishTargets as unknown as ReturnType<typeof vi.fn>;
const mockCreate = api.createPublishTarget as unknown as ReturnType<typeof vi.fn>;
const mockDelete = api.deletePublishTarget as unknown as ReturnType<typeof vi.fn>;

function mkTarget(over: Partial<PublishTarget> = {}): PublishTarget {
  return {
    id: "pt-1",
    platform: "xiaohongshu",
    name: "中台",
    provider: "webhook",
    config: { url: "https://mid.example.com/publish" },
    ...over,
  };
}

async function flush() {
  await act(async () => {});
}

async function renderTargets(open = true) {
  const onClose = vi.fn();
  render(<PublishTargets open={open} onClose={onClose} />);
  if (open) {
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await flush();
  }
  return { onClose };
}

describe("PublishTargets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue(mkTarget({ id: "pt-new" }));
    mockDelete.mockResolvedValue(undefined);
  });

  it("renders nothing and does not fetch when closed", () => {
    const { container } = render(<PublishTargets open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("renders title and column headers", async () => {
    await renderTargets();
    expect(screen.getByText("发布渠道")).toBeInTheDocument();
    for (const h of ["平台", "名称", "渠道类型", "目标地址"]) {
      expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    }
  });

  it("shows a loading row while fetching", () => {
    mockList.mockReturnValue(new Promise(() => {})); // never resolves
    render(<PublishTargets open onClose={vi.fn()} />);
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    await renderTargets();
    expect(screen.getByText("暂无发布渠道，先在下方新增。")).toBeInTheDocument();
  });

  it("renders a target row and an em dash for a missing name", async () => {
    mockList.mockResolvedValue([
      mkTarget(),
      mkTarget({ id: "pt-2", name: null, platform: "wechat", config: { url: "https://a" } }),
    ]);
    await renderTargets();
    expect(screen.getByText("xiaohongshu")).toBeInTheDocument();
    expect(screen.getByText("中台")).toBeInTheDocument();
    expect(screen.getAllByText("webhook").length).toBe(2);
    expect(screen.getByText("https://mid.example.com/publish")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("blocks adding when platform or url is missing", async () => {
    await renderTargets();
    // only platform, no url
    fireEvent.change(screen.getByPlaceholderText("平台"), { target: { value: "wechat" } });
    fireEvent.click(screen.getByText("添加"));
    await flush();
    expect(screen.getByText("平台与目标地址不能为空")).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a target with webhook default and omits empty optional fields", async () => {
    await renderTargets();
    fireEvent.change(screen.getByPlaceholderText("平台"), { target: { value: "douyin" } });
    fireEvent.change(screen.getByPlaceholderText(/Webhook URL/), {
      target: { value: "https://m.example.com/hook" },
    });
    fireEvent.click(screen.getByText("添加"));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        platform: "douyin",
        name: undefined,
        provider: "webhook",
        url: "https://m.example.com/hook",
        token: undefined,
        metricsSecret: undefined,
      }),
    );
    // form reset
    expect((screen.getByPlaceholderText("平台") as HTMLInputElement).value).toBe("");
  });

  it("passes name, token and metrics secret when provided", async () => {
    await renderTargets();
    fireEvent.change(screen.getByPlaceholderText("平台"), { target: { value: "taobao" } });
    fireEvent.change(screen.getByPlaceholderText("名称"), { target: { value: "店铺中台" } });
    fireEvent.change(screen.getByPlaceholderText(/Webhook URL/), {
      target: { value: "https://t/hook" },
    });
    fireEvent.change(screen.getByPlaceholderText("访问令牌（可选）"), {
      target: { value: "tok" },
    });
    fireEvent.change(screen.getByPlaceholderText("效果回流密钥（用于外部回传效果数据）"), {
      target: { value: "sec" },
    });
    fireEvent.click(screen.getByText("添加"));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "店铺中台", token: "tok", metricsSecret: "sec" }),
      ),
    );
  });

  it("deletes a target", async () => {
    mockList.mockResolvedValue([mkTarget()]);
    await renderTargets();
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("pt-1"));
  });

  it("closes on Escape and backdrop, not on modal body", async () => {
    const { onClose } = await renderTargets();
    fireEvent.click(document.querySelector(".modal")!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector(".modal-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
