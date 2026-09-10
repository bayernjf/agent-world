import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { BrandAsset } from "../lib/api";
import BrandAssets from "./BrandAssets";

vi.mock("../lib/api", () => ({
  api: {
    listBrandAssets: vi.fn(),
    addBrandAsset: vi.fn(),
    deleteBrandAsset: vi.fn(),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockList = api.listBrandAssets as unknown as ReturnType<typeof vi.fn>;
const mockAdd = api.addBrandAsset as unknown as ReturnType<typeof vi.fn>;
const mockDelete = api.deleteBrandAsset as unknown as ReturnType<typeof vi.fn>;

function mkAsset(over: Partial<BrandAsset> = {}): BrandAsset {
  return {
    id: "ba-1",
    type: "image",
    label: "主视觉",
    uri: "https://example.com/a.png",
    tags: ["品牌", "KV"],
    createdAt: 1,
    ...over,
  };
}

async function flush() {
  await act(async () => {});
}

async function renderAssets(open = true) {
  const onClose = vi.fn();
  render(<BrandAssets open={open} onClose={onClose} />);
  if (open) {
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await flush();
  }
  return { onClose };
}

describe("BrandAssets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
    mockAdd.mockResolvedValue(mkAsset({ id: "ba-new" }));
    mockDelete.mockResolvedValue(undefined);
  });

  it("renders nothing and does not fetch when closed", () => {
    const { container } = render(<BrandAssets open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("renders title and all five type options", async () => {
    await renderAssets();
    expect(screen.getByText("品牌素材库")).toBeInTheDocument();
    const select = document.querySelector("select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Logo",
      "图片",
      "字体",
      "文案片段",
      "品牌规范",
    ]);
  });

  it("shows the empty state", async () => {
    await renderAssets();
    expect(screen.getByText("暂无素材，先在下方添加。")).toBeInTheDocument();
  });

  it("renders an asset with localized type, uri and tags", async () => {
    mockList.mockResolvedValue([mkAsset()]);
    await renderAssets();
    expect(screen.getByText("主视觉")).toBeInTheDocument();
    // "图片" appears once in the type <select> option and once on the row
    expect(screen.getAllByText("图片").length).toBe(2);
    expect(screen.getByText(/example.com/)).toBeInTheDocument();
    expect(screen.getByText(/品牌, KV/)).toBeInTheDocument();
  });

  it("keeps add disabled until a label is entered", async () => {
    await renderAssets();
    const addBtn = screen.getByText("添加") as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("素材名称（必填）"), {
      target: { value: "新素材" },
    });
    expect(addBtn.disabled).toBe(false);
  });

  it("adds an asset, splitting tags on both ASCII and Chinese commas", async () => {
    await renderAssets();
    fireEvent.change(screen.getByPlaceholderText("素材名称（必填）"), {
      target: { value: "Logo 主标" },
    });
    fireEvent.change(screen.getByPlaceholderText("链接 / 内容（可选）"), {
      target: { value: "https://x" },
    });
    fireEvent.change(screen.getByPlaceholderText("标签，逗号分隔（可选）"), {
      target: { value: "a, b，c" },
    });
    fireEvent.click(screen.getByText("添加"));
    await waitFor(() =>
      expect(mockAdd).toHaveBeenCalledWith({
        type: "image",
        label: "Logo 主标",
        uri: "https://x",
        tags: ["a", "b", "c"],
      }),
    );
    // form cleared
    expect((screen.getByPlaceholderText("素材名称（必填）") as HTMLInputElement).value).toBe("");
  });

  it("deletes an asset", async () => {
    mockList.mockResolvedValue([mkAsset()]);
    await renderAssets();
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("ba-1"));
  });

  it("closes on Escape and backdrop, not on modal body", async () => {
    const { onClose } = await renderAssets();
    fireEvent.click(document.querySelector(".modal")!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector(".modal-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
