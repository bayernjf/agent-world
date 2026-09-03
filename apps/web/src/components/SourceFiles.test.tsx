import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import SourceFiles from "./SourceFiles";
import type { SourceFile } from "@agent-world/core";

// Mock api
const mockUploadArtifact = vi.fn();
vi.mock("../lib/api", () => ({
  api: {
    uploadArtifact: (file: File) => mockUploadArtifact(file),
  },
}));

// Mock useGraph
const mockUpdateNode = vi.fn();
vi.mock("../store/graph", () => ({
  useGraph: () => ({
    updateNode: mockUpdateNode,
    graph: {
      nodes: [
        { id: "node-1", kind: "source", name: "原料台", source: {} },
      ],
    },
  }),
}));

const sampleFiles: SourceFile[] = [
  { uri: "/api/artifacts/up-1", label: "产品手册.pdf", mimeType: "application/pdf", sizeBytes: 1048576 },
  { uri: "/api/artifacts/up-2", label: "规格说明.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 512000 },
  { uri: "/api/artifacts/up-3", label: "演示文稿.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", sizeBytes: 2097152 },
];

function renderComponent(overrides: Partial<{
  nodeId: string;
  files: SourceFile[];
  onBeginEdit: () => void;
  onCommitEdit: () => void;
}> = {}) {
  const onBeginEdit = vi.fn();
  const onCommitEdit = vi.fn();
  render(
    <SourceFiles
      nodeId={overrides.nodeId ?? "node-1"}
      files={overrides.files ?? sampleFiles}
      onBeginEdit={overrides.onBeginEdit ?? onBeginEdit}
      onCommitEdit={overrides.onCommitEdit ?? onCommitEdit}
    />,
  );
  return {
    onBeginEdit: overrides.onBeginEdit ?? onBeginEdit,
    onCommitEdit: overrides.onCommitEdit ?? onCommitEdit,
  };
}

function createFile(name: string, size: number, type: string): File {
  const file = new File(["content"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("SourceFiles", () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    mockUpdateNode.mockClear();
    mockUploadArtifact.mockResolvedValue({
      id: "up-new",
      uri: "/api/artifacts/up-new",
      label: "新文件.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100000,
    });
  });

  describe("渲染", () => {
    it("显示文档标签", () => {
      renderComponent();
      expect(screen.getByText(/文档（PDF \/ DOCX \/ PPTX/)).toBeInTheDocument();
    });

    it("显示上传区域", () => {
      renderComponent();
      expect(screen.getByText("点击上传文档，或把文件拖到这里")).toBeInTheDocument();
    });

    it("上传区域有 image-dropzone class", () => {
      renderComponent();
      expect(document.querySelector(".image-dropzone")).toBeInTheDocument();
    });

    it("有 field class", () => {
      renderComponent();
      expect(document.querySelector(".field")).toBeInTheDocument();
    });

    it("文件列表有 image-list class", () => {
      renderComponent();
      expect(document.querySelector(".image-list")).toBeInTheDocument();
    });

    it("文件为空时不显示文件列表", () => {
      renderComponent({ files: [] });
      expect(document.querySelector(".image-list")).not.toBeInTheDocument();
    });
  });

  describe("文件列表", () => {
    it("显示所有文件", () => {
      renderComponent();
      const rows = document.querySelectorAll(".image-row");
      expect(rows.length).toBe(3);
    });

    it("显示文件名", () => {
      renderComponent();
      expect(screen.getByDisplayValue(/产品手册.pdf/)).toBeInTheDocument();
      expect(screen.getByDisplayValue(/规格说明.docx/)).toBeInTheDocument();
    });

    it("显示文件大小", () => {
      renderComponent();
      const inputs = document.querySelectorAll(".image-row input");
      expect(inputs[0].getAttribute("value")).toContain("1.0 MB");
      expect(inputs[1].getAttribute("value")).toContain("500 KB");
      expect(inputs[2].getAttribute("value")).toContain("2.0 MB");
    });

    it("无 label 时从 uri 解析文件名", () => {
      const filesWithoutLabel: SourceFile[] = [
        { uri: "/api/artifacts/up-no-label", label: undefined, mimeType: "application/pdf", sizeBytes: 100000 },
      ];
      renderComponent({ files: filesWithoutLabel });
      const inputs = document.querySelectorAll(".image-row input");
      expect(inputs[0].getAttribute("value")).toContain("up-no-label");
    });

    it("显示扩展名缩略图", () => {
      renderComponent();
      const thumbs = document.querySelectorAll(".image-row__thumb");
      expect(thumbs[0].textContent).toBe("PDF");
      expect(thumbs[1].textContent).toBe("DOCX");
      expect(thumbs[2].textContent).toBe("PPTX");
    });

    it("缩略图有 placeholder class", () => {
      renderComponent();
      expect(document.querySelector(".image-row__thumb--placeholder")).toBeInTheDocument();
    });

    it("每个文件有删除按钮", () => {
      renderComponent();
      const deleteBtns = document.querySelectorAll(".image-row .icon-btn--danger");
      expect(deleteBtns.length).toBe(3);
    });

    it("文件输入框 readOnly", () => {
      renderComponent();
      const inputs = document.querySelectorAll(".image-row input");
      expect(inputs[0]).toHaveAttribute("readonly");
    });

    it("文件输入框 title 为 uri", () => {
      renderComponent();
      const inputs = document.querySelectorAll(".image-row input");
      expect(inputs[0]).toHaveAttribute("title", "/api/artifacts/up-1");
    });
  });

  describe("删除文件", () => {
    it("点击删除按钮调用 updateNode", () => {
      renderComponent();
      const deleteBtns = document.querySelectorAll(".image-row .icon-btn--danger");
      fireEvent.click(deleteBtns[0]);
      expect(mockUpdateNode).toHaveBeenCalledTimes(1);
    });

    it("删除后剩余文件正确", () => {
      renderComponent();
      const deleteBtns = document.querySelectorAll(".image-row .icon-btn--danger");
      fireEvent.click(deleteBtns[0]);
      const callArgs = mockUpdateNode.mock.calls[0];
      const updatedFiles = callArgs[1].source.files;
      expect(updatedFiles.length).toBe(2);
      expect(updatedFiles[0].label).toBe("规格说明.docx");
    });

    it("删除最后一个文件后列表为空", () => {
      renderComponent({ files: [sampleFiles[0]] });
      const deleteBtns = document.querySelectorAll(".image-row .icon-btn--danger");
      fireEvent.click(deleteBtns[0]);
      const callArgs = mockUpdateNode.mock.calls[0];
      expect(callArgs[1].source.files.length).toBe(0);
    });
  });

  describe("上传 - 点击", () => {
    it("点击上传区域触发文件选择", () => {
      renderComponent();
      const dropzone = document.querySelector(".image-dropzone")!;
      const input = document.querySelector("input[type='file']") as HTMLInputElement;
      const clickSpy = vi.spyOn(input, "click");
      fireEvent.click(dropzone);
      expect(clickSpy).toHaveBeenCalled();
    });

    it("文件输入框 accept 包含 PDF/DOCX/PPTX", () => {
      renderComponent();
      const input = document.querySelector("input[type='file']") as HTMLInputElement;
      expect(input.accept).toContain(".pdf");
      expect(input.accept).toContain(".docx");
      expect(input.accept).toContain(".pptx");
    });

    it("文件输入框支持 multiple", () => {
      renderComponent();
      const input = document.querySelector("input[type='file']") as HTMLInputElement;
      expect(input).toHaveAttribute("multiple");
    });

    it("文件输入框 hidden", () => {
      renderComponent();
      const input = document.querySelector("input[type='file']") as HTMLInputElement;
      expect(input).toHaveAttribute("hidden");
    });
  });

  describe("上传 - 拖拽", () => {
    it("拖拽进入时设置 is-over class", () => {
      renderComponent();
      const dropzone = document.querySelector(".image-dropzone")!;
      fireEvent.dragOver(dropzone);
      expect(dropzone.classList.contains("is-over")).toBe(true);
    });

    it("拖拽离开时移除 is-over class", () => {
      renderComponent();
      const dropzone = document.querySelector(".image-dropzone")!;
      fireEvent.dragOver(dropzone);
      expect(dropzone.classList.contains("is-over")).toBe(true);
      fireEvent.dragLeave(dropzone);
      expect(dropzone.classList.contains("is-over")).toBe(false);
    });

    it("drop 时移除 is-over class", () => {
      renderComponent();
      const dropzone = document.querySelector(".image-dropzone")!;
      fireEvent.dragOver(dropzone);
      const file = createFile("test.pdf", 100000, "application/pdf");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      expect(dropzone.classList.contains("is-over")).toBe(false);
    });
  });

  describe("上传 - 文件验证", () => {
    it("不支持的文件类型显示错误", async () => {
      renderComponent({ files: [] });
      const dropzone = document.querySelector(".image-dropzone")!;
      const file = createFile("test.txt", 100000, "text/plain");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      await waitFor(() => {
        expect(screen.getByText(/已跳过：test.txt/)).toBeInTheDocument();
      });
    });

    it("不支持的文件类型提示仅支持 PDF/DOCX/PPTX", async () => {
      renderComponent({ files: [] });
      const dropzone = document.querySelector(".image-dropzone")!;
      const file = createFile("test.txt", 100000, "text/plain");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      await waitFor(() => {
        expect(screen.getByText(/仅支持 PDF \/ DOCX \/ PPTX/)).toBeInTheDocument();
      });
    });

    it("超过 5MB 的文件显示错误", async () => {
      renderComponent({ files: [] });
      const dropzone = document.querySelector(".image-dropzone")!;
      const file = createFile("large.pdf", 6 * 1024 * 1024, "application/pdf");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      await waitFor(() => {
        expect(screen.getByText(/解析上限 5 MB/)).toBeInTheDocument();
      });
    });

    it("错误信息有 diag diag--error class", async () => {
      renderComponent({ files: [] });
      const dropzone = document.querySelector(".image-dropzone")!;
      const file = createFile("test.txt", 100000, "text/plain");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      await waitFor(() => {
        expect(document.querySelector(".diag--error")).toBeInTheDocument();
      });
    });

    it("全部文件被拒绝时不调用 uploadArtifact", async () => {
      renderComponent({ files: [] });
      const dropzone = document.querySelector(".image-dropzone")!;
      const file = createFile("test.txt", 100000, "text/plain");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      await waitFor(() => {
        expect(mockUploadArtifact).not.toHaveBeenCalled();
      });
    });
  });

  describe("上传 - 成功", () => {
    it("上传中显示'上传中…'", async () => {
      mockUploadArtifact.mockImplementation(() => new Promise(() => {}));
      renderComponent({ files: [] });
      const dropzone = document.querySelector(".image-dropzone")!;
      const file = createFile("test.pdf", 100000, "application/pdf");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      await waitFor(() => {
        expect(screen.getByText("上传中…")).toBeInTheDocument();
      });
    });

    it("上传中 dropzone 有 is-loading class", async () => {
      mockUploadArtifact.mockImplementation(() => new Promise(() => {}));
      renderComponent({ files: [] });
      const dropzone = document.querySelector(".image-dropzone")!;
      const file = createFile("test.pdf", 100000, "application/pdf");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      await waitFor(() => {
        expect(dropzone.classList.contains("is-loading")).toBe(true);
      });
    });

    it("上传成功后调用 updateNode", async () => {
      renderComponent({ files: [] });
      const dropzone = document.querySelector(".image-dropzone")!;
      const file = createFile("test.pdf", 100000, "application/pdf");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      await waitFor(() => {
        expect(mockUpdateNode).toHaveBeenCalledTimes(1);
      });
    });

    it("上传成功后文件添加到列表", async () => {
      renderComponent({ files: [] });
      const dropzone = document.querySelector(".image-dropzone")!;
      const file = createFile("test.pdf", 100000, "application/pdf");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      await waitFor(() => {
        const callArgs = mockUpdateNode.mock.calls[0];
        expect(callArgs[1].source.files.length).toBe(1);
        expect(callArgs[1].source.files[0].label).toBe("新文件.pdf");
      });
    });

    it("上传成功后保留原有文件", async () => {
      renderComponent({ files: [sampleFiles[0]] });
      const dropzone = document.querySelector(".image-dropzone")!;
      const file = createFile("test.pdf", 100000, "application/pdf");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      await waitFor(() => {
        const callArgs = mockUpdateNode.mock.calls[0];
        expect(callArgs[1].source.files.length).toBe(2);
        expect(callArgs[1].source.files[0].label).toBe("产品手册.pdf");
        expect(callArgs[1].source.files[1].label).toBe("新文件.pdf");
      });
    });

    it("上传成功后清除文件输入框值", async () => {
      renderComponent({ files: [] });
      const input = document.querySelector("input[type='file']") as HTMLInputElement;
      const dropzone = document.querySelector(".image-dropzone")!;
      const file = createFile("test.pdf", 100000, "application/pdf");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      await waitFor(() => {
        expect(input.value).toBe("");
      });
    });
  });

  describe("上传 - 失败", () => {
    it("上传失败显示错误信息", async () => {
      mockUploadArtifact.mockRejectedValue(new Error("上传失败：网络错误"));
      renderComponent({ files: [] });
      const dropzone = document.querySelector(".image-dropzone")!;
      const file = createFile("test.pdf", 100000, "application/pdf");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      await waitFor(() => {
        expect(screen.getByText("上传失败：网络错误")).toBeInTheDocument();
      });
    });

    it("上传失败后不调用 updateNode", async () => {
      mockUploadArtifact.mockRejectedValue(new Error("上传失败"));
      renderComponent({ files: [] });
      const dropzone = document.querySelector(".image-dropzone")!;
      const file = createFile("test.pdf", 100000, "application/pdf");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      await waitFor(() => {
        expect(mockUpdateNode).not.toHaveBeenCalled();
      });
    });

    it("上传失败后清除上传状态", async () => {
      mockUploadArtifact.mockRejectedValue(new Error("上传失败"));
      renderComponent({ files: [] });
      const dropzone = document.querySelector(".image-dropzone")!;
      const file = createFile("test.pdf", 100000, "application/pdf");
      fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
      await waitFor(() => {
        expect(screen.getByText("点击上传文档，或把文件拖到这里")).toBeInTheDocument();
      });
    });
  });

  describe("编辑回调", () => {
    it("文件输入框 focus 时调用 onBeginEdit", () => {
      const { onBeginEdit } = renderComponent();
      const inputs = document.querySelectorAll(".image-row input");
      fireEvent.focus(inputs[0]);
      expect(onBeginEdit).toHaveBeenCalledTimes(1);
    });

    it("文件输入框 blur 时调用 onCommitEdit", () => {
      const { onCommitEdit } = renderComponent();
      const inputs = document.querySelectorAll(".image-row input");
      fireEvent.focus(inputs[0]);
      fireEvent.blur(inputs[0]);
      expect(onCommitEdit).toHaveBeenCalledTimes(1);
    });
  });
});
