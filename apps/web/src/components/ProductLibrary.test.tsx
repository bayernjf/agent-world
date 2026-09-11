import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { Product } from "../lib/api";
import ProductLibrary from "./ProductLibrary";

vi.mock("../lib/api", () => ({
  api: {
    listProducts: vi.fn(),
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    deleteProduct: vi.fn(),
    importProducts: vi.fn(),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockList = api.listProducts as unknown as ReturnType<typeof vi.fn>;
const mockAdd = api.addProduct as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = api.updateProduct as unknown as ReturnType<typeof vi.fn>;
const mockDelete = api.deleteProduct as unknown as ReturnType<typeof vi.fn>;
const mockImport = api.importProducts as unknown as ReturnType<typeof vi.fn>;

function mkProduct(over: Partial<Product> = {}): Product {
  return {
    id: "pr-1",
    sku: "SKU-1",
    name: "复古托特包",
    brand: "某品牌",
    category: "箱包",
    price: 99.9,
    attributes: {},
    images: [],
    status: "active",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

async function flush() {
  await act(async () => {});
}

async function renderLibrary(open = true) {
  const onClose = vi.fn();
  render(<ProductLibrary open={open} onClose={onClose} />);
  if (open) {
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await flush();
  }
  return { onClose };
}

describe("ProductLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
    mockAdd.mockResolvedValue(mkProduct({ id: "pr-new" }));
    mockUpdate.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockImport.mockResolvedValue({ imported: 0, failed: 0, errors: [] });
  });

  it("renders nothing and does not fetch when closed", () => {
    const { container } = render(<ProductLibrary open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("renders title and column headers when open", async () => {
    await renderLibrary();
    expect(screen.getByText("商品库")).toBeInTheDocument();
    for (const h of ["商品名", "品牌", "分类", "价格", "状态"]) {
      expect(screen.getByText(h)).toBeInTheDocument();
    }
  });

  it("shows the empty state when there are no products", async () => {
    await renderLibrary();
    expect(screen.getByText(/暂无商品/)).toBeInTheDocument();
  });

  it("renders a product row with name, brand, category, price and active status", async () => {
    mockList.mockResolvedValue([mkProduct()]);
    await renderLibrary();
    expect(screen.getByText("复古托特包")).toBeInTheDocument();
    expect(screen.getByText("某品牌")).toBeInTheDocument();
    expect(screen.getByText("箱包")).toBeInTheDocument();
    expect(screen.getByText("¥99.9")).toBeInTheDocument();
    expect(screen.getByText("在用")).toBeInTheDocument();
  });

  it("renders em dashes for missing brand/category and null price", async () => {
    mockList.mockResolvedValue([mkProduct({ brand: "", category: "", price: null })]);
    await renderLibrary();
    // two empty cells + one price cell = three "—"
    expect(screen.getAllByText("—").length).toBe(3);
  });

  it("keeps the add button disabled until a name is entered", async () => {
    await renderLibrary();
    const addBtn = screen.getByText("添加") as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("商品名（必填）"), { target: { value: "新品" } });
    expect(addBtn.disabled).toBe(false);
  });

  it("adds a product with the parsed payload and clears the form", async () => {
    await renderLibrary();
    fireEvent.change(screen.getByPlaceholderText("商品名（必填）"), { target: { value: "新品" } });
    fireEvent.change(screen.getByPlaceholderText("SKU（可选）"), { target: { value: "SKU-9" } });
    fireEvent.change(screen.getByPlaceholderText("品牌（可选）"), { target: { value: "牌子" } });
    fireEvent.change(screen.getByPlaceholderText("分类（可选）"), { target: { value: "分类X" } });
    fireEvent.change(screen.getByPlaceholderText("价格（可选）"), { target: { value: "49.5" } });
    fireEvent.click(screen.getByText("添加"));
    await waitFor(() =>
      expect(mockAdd).toHaveBeenCalledWith({
        name: "新品",
        sku: "SKU-9",
        brand: "牌子",
        category: "分类X",
        price: 49.5,
      }),
    );
    await flush();
    // form cleared
    expect((screen.getByPlaceholderText("商品名（必填）") as HTMLInputElement).value).toBe("");
  });

  it("sends null price when the price field is left blank", async () => {
    await renderLibrary();
    fireEvent.change(screen.getByPlaceholderText("商品名（必填）"), { target: { value: "无价品" } });
    fireEvent.click(screen.getByText("添加"));
    await waitFor(() =>
      expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ name: "无价品", price: null })),
    );
  });

  it("archives an active product and restores an archived one", async () => {
    const { rerender } = render(
      <ProductLibrary open onClose={vi.fn()} />,
    );
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    mockList.mockResolvedValue([mkProduct()]);
    await flush();
    rerender(<ProductLibrary open onClose={vi.fn()} />);
    await flush();
    // active row offers 归档
    fireEvent.click(screen.getByText("归档"));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith("pr-1", { status: "archived" }));

    // now return an archived product
    mockList.mockResolvedValue([mkProduct({ status: "archived" })]);
    rerender(<ProductLibrary open onClose={vi.fn()} />);
    await flush();
    expect(screen.getByText("已归档")).toBeInTheDocument();
    expect(document.querySelector("tr.is-archived")).not.toBeNull();
    fireEvent.click(screen.getByText("恢复"));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith("pr-1", { status: "active" }));
  });

  it("deletes a product", async () => {
    mockList.mockResolvedValue([mkProduct()]);
    await renderLibrary();
    fireEvent.click(screen.getByText("删除"));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("pr-1"));
  });

  it("keeps the import button disabled until CSV text is entered", async () => {
    await renderLibrary();
    const btn = screen.getByText("导入 CSV") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/name,sku,brand/), {
      target: { value: "name\nA" },
    });
    expect(btn.disabled).toBe(false);
  });

  it("imports CSV and shows the import summary", async () => {
    mockImport.mockResolvedValue({ imported: 2, failed: 0, errors: [] });
    await renderLibrary();
    fireEvent.change(screen.getByPlaceholderText(/name,sku,brand/), {
      target: { value: "name\nA\nB" },
    });
    fireEvent.click(screen.getByText("导入 CSV"));
    await waitFor(() => expect(mockImport).toHaveBeenCalledWith("name\nA\nB"));
    await flush();
    expect(screen.getByText("导入 2 条，失败 0 条")).toBeInTheDocument();
  });

  it("surfaces per-row import errors in the summary", async () => {
    mockImport.mockResolvedValue({ imported: 1, failed: 1, errors: ["第 2 行缺 name"] });
    await renderLibrary();
    fireEvent.change(screen.getByPlaceholderText(/name,sku,brand/), {
      target: { value: "name\nA\nB" },
    });
    fireEvent.click(screen.getByText("导入 CSV"));
    await waitFor(() => expect(screen.getByText(/第 2 行缺 name/)).toBeInTheDocument());
  });

  it("closes on Escape and on backdrop, not on modal body", async () => {
    const { onClose } = await renderLibrary();
    fireEvent.click(document.querySelector(".modal")!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector(".modal-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
