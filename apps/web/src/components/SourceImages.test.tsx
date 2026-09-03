import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SourceImages from "./SourceImages";

// Mock api
const mockUploadArtifact = vi.fn();
vi.mock("../lib/api", () => ({
  api: {
    uploadArtifact: (file: File) => mockUploadArtifact(file),
  },
}));

// Mock useGraph store
const mockUpdateNode = vi.fn();
vi.mock("../store/graph", () => ({
  useGraph: vi.fn(),
}));

// Mock Tooltip (imported but not used in component)
vi.mock("./Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { useGraph } from "../store/graph";
const mockUseGraph = useGraph as unknown as ReturnType<typeof vi.fn>;

const sampleGraph = {
  nodes: [
    {
      id: "node-1",
      source: { images: ["https://example.com/img1.jpg", "/api/artifacts/abc123"] },
    },
  ],
};

function setupMocks(overrides: Partial<ReturnType<typeof useGraph>> = {}) {
  mockUseGraph.mockReturnValue({
    updateNode: mockUpdateNode,
    graph: sampleGraph,
    ...overrides,
  });
}

function renderComponent(overrides: Partial<{
  nodeId: string;
  images: string[];
  onBeginEdit: () => void;
  onCommitEdit: () => void;
}> = {}) {
  const onBeginEdit = vi.fn();
  const onCommitEdit = vi.fn();
  render(
    <SourceImages
      nodeId={overrides.nodeId ?? "node-1"}
      images={overrides.images ?? ["https://example.com/img1.jpg", "/api/artifacts/abc123"]}
      onBeginEdit={overrides.onBeginEdit ?? onBeginEdit}
      onCommitEdit={overrides.onCommitEdit ?? onCommitEdit}
    />,
  );
  return {
    onBeginEdit: overrides.onBeginEdit ?? onBeginEdit,
    onCommitEdit: overrides.onCommitEdit ?? onCommitEdit,
  };
}

describe("SourceImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  describe("渲染", () => {
    it("显示标签文字", () => {
      renderComponent();
      expect(screen.getByText(/产品图片/)).toBeInTheDocument();
    });

    it("显示上传区域提示文字", () => {
      renderComponent();
      expect(screen.getByText("点击上传，或把产品图拖到这里")).toBeInTheDocument();
    });

    it("有 field class", () => {
      renderComponent();
      expect(document.querySelector(".field")).toBeInTheDocument();
    });

    it("有 image-dropzone class", () => {
      renderComponent();
      expect(document.querySelector(".image-dropzone")).toBeInTheDocument();
    });

    it("有 image-list class", () => {
      renderComponent();
      expect(document.querySelector(".image-list")).toBeInTheDocument();
    });

    it("有隐藏的 file input", () => {
      renderComponent();
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.hidden).toBe(true);
      expect(input.accept).toBe("image/*");
      expect(input.multiple).toBe(true);
    });
  });

  describe("图片列表", () => {
    it("渲染所有图片", () => {
      renderComponent();
      const inputs = screen.getAllByPlaceholderText("https://... 或 /api/artifacts/...");
      expect(inputs).toHaveLength(2);
    });

    it("图片 URL 显示在输入框中", () => {
      renderComponent();
      const inputs = screen.getAllByPlaceholderText("https://... 或 /api/artifacts/...");
      expect(inputs[0]).toHaveValue("https://example.com/img1.jpg");
      expect(inputs[1]).toHaveValue("/api/artifacts/abc123");
    });

    it("每个图片有删除按钮", () => {
      renderComponent();
      expect(screen.getAllByRole("button", { name: "✕" })).toHaveLength(2);
    });

    it("显示添加图片 URL 按钮", () => {
      renderComponent();
      expect(screen.getByText("+ 添加图片 URL")).toBeInTheDocument();
    });

    it("图片列表为空时只显示添加按钮", () => {
      renderComponent({ images: [] });
      const inputs = screen.queryAllByPlaceholderText("https://... 或 /api/artifacts/...");
      expect(inputs).toHaveLength(0);
      expect(screen.getByText("+ 添加图片 URL")).toBeInTheDocument();
    });
  });

  describe("缩略图", () => {
    it("http URL 显示 img 缩略图", () => {
      renderComponent();
      const imgs = document.querySelectorAll(".image-row__thumb");
      expect(imgs[0].tagName).toBe("IMG");
      expect((imgs[0] as HTMLImageElement).src).toBe("https://example.com/img1.jpg");
    });

    it("/api/artifacts/ URL 显示 img 缩略图", () => {
      renderComponent();
      const imgs = document.querySelectorAll(".image-row__thumb");
      expect(imgs[1].tagName).toBe("IMG");
      expect((imgs[1] as HTMLImageElement).src).toContain("/api/artifacts/abc123");
    });

    it("非图片 URL 显示占位符", () => {
      renderComponent({ images: ["not-an-image-url"] });
      const placeholder = document.querySelector(".image-row__thumb--placeholder");
      expect(placeholder).toBeInTheDocument();
      expect(placeholder?.textContent).toBe("图");
    });

    it("img 有 loading=lazy 属性", () => {
      renderComponent();
      const imgs = document.querySelectorAll("img.image-row__thumb");
      expect(imgs[0]).toHaveAttribute("loading", "lazy");
    });

    it("img 有 alt 属性（空）", () => {
      renderComponent();
      const imgs = document.querySelectorAll("img.image-row__thumb");
      expect(imgs[0]).toHaveAttribute("alt", "");
    });
  });

  describe("交互 - 修改 URL", () => {
    it("修改图片 URL 调用 updateNode", () => {
      renderComponent();
      const inputs = screen.getAllByPlaceholderText("https://... 或 /api/artifacts/...");
      fireEvent.change(inputs[0], { target: { value: "https://new.example.com/img.jpg" } });
      expect(mockUpdateNode).toHaveBeenCalledTimes(1);
    });

    it("修改 URL 时保留其他图片", () => {
      renderComponent();
      const inputs = screen.getAllByPlaceholderText("https://... 或 /api/artifacts/...");
      fireEvent.change(inputs[0], { target: { value: "https://new.example.com/img.jpg" } });
      const callArg = mockUpdateNode.mock.calls[0][1];
      expect(callArg.source.images).toEqual([
        "https://new.example.com/img.jpg",
        "/api/artifacts/abc123",
      ]);
    });
  });

  describe("交互 - 删除图片", () => {
    it("点击删除按钮调用 updateNode", () => {
      renderComponent();
      const deleteBtns = screen.getAllByRole("button", { name: "✕" });
      fireEvent.click(deleteBtns[0]);
      expect(mockUpdateNode).toHaveBeenCalledTimes(1);
    });

    it("删除第一张图片后保留第二张", () => {
      renderComponent();
      const deleteBtns = screen.getAllByRole("button", { name: "✕" });
      fireEvent.click(deleteBtns[0]);
      const callArg = mockUpdateNode.mock.calls[0][1];
      expect(callArg.source.images).toEqual(["/api/artifacts/abc123"]);
    });

    it("删除按钮有 icon-btn--danger class", () => {
      renderComponent();
      const deleteBtns = screen.getAllByRole("button", { name: "✕" });
      expect(deleteBtns[0].classList.contains("icon-btn--danger")).toBe(true);
    });
  });

  describe("交互 - 添加图片 URL", () => {
    it("点击添加按钮调用 updateNode", () => {
      renderComponent();
      fireEvent.click(screen.getByText("+ 添加图片 URL"));
      expect(mockUpdateNode).toHaveBeenCalledTimes(1);
    });

    it("添加空字符串 URL", () => {
      renderComponent();
      fireEvent.click(screen.getByText("+ 添加图片 URL"));
      const callArg = mockUpdateNode.mock.calls[0][1];
      expect(callArg.source.images).toEqual([
        "https://example.com/img1.jpg",
        "/api/artifacts/abc123",
        "",
      ]);
    });

    it("添加按钮有 image-list__add class", () => {
      renderComponent();
      expect(screen.getByText("+ 添加图片 URL").classList.contains("image-list__add")).toBe(true);
    });
  });

  describe("交互 - 上传", () => {
    it("点击上传区域触发 file input click", () => {
      renderComponent();
      const dropzone = document.querySelector(".image-dropzone")!;
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const clickSpy = vi.spyOn(input, "click");
      fireEvent.click(dropzone);
      expect(clickSpy).toHaveBeenCalled();
    });

    it("上传图片文件调用 api.uploadArtifact", async () => {
      mockUploadArtifact.mockResolvedValue({ uri: "/api/artifacts/new123" });
      renderComponent();
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["dummy"], "test.jpg", { type: "image/jpeg" });
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => {
        expect(mockUploadArtifact).toHaveBeenCalledWith(file);
      });
    });

    it("上传成功后调用 updateNode 添加新 URL", async () => {
      mockUploadArtifact.mockResolvedValue({ uri: "/api/artifacts/new123" });
      renderComponent();
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["dummy"], "test.jpg", { type: "image/jpeg" });
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => {
        expect(mockUpdateNode).toHaveBeenCalled();
      });
      const lastCall = mockUpdateNode.mock.calls[mockUpdateNode.mock.calls.length - 1];
      expect(lastCall[1].source.images).toContain("/api/artifacts/new123");
    });

    it("上传中显示'上传中…'", async () => {
      mockUploadArtifact.mockImplementation(() => new Promise(() => {}));
      renderComponent();
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["dummy"], "test.jpg", { type: "image/jpeg" });
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => {
        expect(screen.getByText("上传中…")).toBeInTheDocument();
      });
    });

    it("上传中 dropzone 有 is-loading class", async () => {
      mockUploadArtifact.mockImplementation(() => new Promise(() => {}));
      renderComponent();
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["dummy"], "test.jpg", { type: "image/jpeg" });
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => {
        expect(document.querySelector(".image-dropzone")?.classList.contains("is-loading")).toBe(true);
      });
    });

    it("上传失败显示错误信息", async () => {
      mockUploadArtifact.mockRejectedValue(new Error("上传失败：文件过大"));
      renderComponent();
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["dummy"], "test.jpg", { type: "image/jpeg" });
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => {
        expect(screen.getByText("上传失败：文件过大")).toBeInTheDocument();
      });
    });

    it("上传失败错误信息有 diag--error class", async () => {
      mockUploadArtifact.mockRejectedValue(new Error("上传失败"));
      renderComponent();
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["dummy"], "test.jpg", { type: "image/jpeg" });
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => {
        expect(document.querySelector(".diag--error")).toBeInTheDocument();
      });
    });

    it("非图片文件被过滤", async () => {
      mockUploadArtifact.mockResolvedValue({ uri: "/api/artifacts/new123" });
      renderComponent();
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["dummy"], "test.txt", { type: "text/plain" });
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => {
        expect(mockUploadArtifact).not.toHaveBeenCalled();
      });
    });

    it("多文件上传调用多次 api.uploadArtifact", async () => {
      mockUploadArtifact.mockResolvedValue({ uri: "/api/artifacts/new123" });
      renderComponent();
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file1 = new File(["dummy1"], "test1.jpg", { type: "image/jpeg" });
      const file2 = new File(["dummy2"], "test2.png", { type: "image/png" });
      fireEvent.change(input, { target: { files: [file1, file2] } });
      await waitFor(() => {
        expect(mockUploadArtifact).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("交互 - 拖拽", () => {
    it("dragOver 时 dropzone 有 is-over class", () => {
      renderComponent();
      const dropzone = document.querySelector(".image-dropzone")!;
      fireEvent.dragOver(dropzone);
      expect(dropzone.classList.contains("is-over")).toBe(true);
    });

    it("dragLeave 时移除 is-over class", () => {
      renderComponent();
      const dropzone = document.querySelector(".image-dropzone")!;
      fireEvent.dragOver(dropzone);
      expect(dropzone.classList.contains("is-over")).toBe(true);
      fireEvent.dragLeave(dropzone);
      expect(dropzone.classList.contains("is-over")).toBe(false);
    });

    it("drop 文件时调用 uploadFiles", async () => {
      mockUploadArtifact.mockResolvedValue({ uri: "/api/artifacts/drop123" });
      renderComponent();
      const dropzone = document.querySelector(".image-dropzone")!;
      const file = new File(["dummy"], "drop.jpg", { type: "image/jpeg" });
      const dataTransfer = { files: [file] };
      fireEvent.drop(dropzone, { dataTransfer });
      await waitFor(() => {
        expect(mockUploadArtifact).toHaveBeenCalledWith(file);
      });
    });

    it("drop 后移除 is-over class", () => {
      renderComponent();
      const dropzone = document.querySelector(".image-dropzone")!;
      fireEvent.dragOver(dropzone);
      expect(dropzone.classList.contains("is-over")).toBe(true);
      const dataTransfer = { files: [] };
      fireEvent.drop(dropzone, { dataTransfer });
      expect(dropzone.classList.contains("is-over")).toBe(false);
    });
  });

  describe("编辑回调", () => {
    it("输入框聚焦时调用 onBeginEdit", () => {
      const { onBeginEdit } = renderComponent();
      const inputs = screen.getAllByPlaceholderText("https://... 或 /api/artifacts/...");
      fireEvent.focus(inputs[0]);
      expect(onBeginEdit).toHaveBeenCalledTimes(1);
    });

    it("输入框失焦时调用 onCommitEdit", () => {
      const { onCommitEdit } = renderComponent();
      const inputs = screen.getAllByPlaceholderText("https://... 或 /api/artifacts/...");
      fireEvent.blur(inputs[0]);
      expect(onCommitEdit).toHaveBeenCalledTimes(1);
    });
  });

  describe("isImageUrl 工具函数", () => {
    it("http URL 被识别为图片 URL", () => {
      renderComponent({ images: ["http://example.com/img.jpg"] });
      const imgs = document.querySelectorAll("img.image-row__thumb");
      expect(imgs.length).toBe(1);
    });

    it("https URL 被识别为图片 URL", () => {
      renderComponent({ images: ["https://example.com/img.jpg"] });
      const imgs = document.querySelectorAll("img.image-row__thumb");
      expect(imgs.length).toBe(1);
    });

    it("/api/artifacts/ URL 被识别为图片 URL", () => {
      renderComponent({ images: ["/api/artifacts/abc123"] });
      const imgs = document.querySelectorAll("img.image-row__thumb");
      expect(imgs.length).toBe(1);
    });

    it("相对路径不被识别为图片 URL", () => {
      renderComponent({ images: ["relative/path.jpg"] });
      const placeholder = document.querySelector(".image-row__thumb--placeholder");
      expect(placeholder).toBeInTheDocument();
    });

    it("空字符串不被识别为图片 URL", () => {
      renderComponent({ images: [""] });
      const placeholder = document.querySelector(".image-row__thumb--placeholder");
      expect(placeholder).toBeInTheDocument();
    });
  });
});
