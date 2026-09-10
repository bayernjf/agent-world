import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { api } from "../lib/api";
import type { Collaborator } from "../lib/api";
import CollaboratorsModal from "./CollaboratorsModal";

vi.mock("../lib/api", () => ({
  api: {
    getGraphAccess: vi.fn(),
    putGraphAccess: vi.fn(),
  },
}));

vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockGet = api.getGraphAccess as unknown as ReturnType<typeof vi.fn>;
const mockPut = api.putGraphAccess as unknown as ReturnType<typeof vi.fn>;

function mkCollab(over: Partial<Collaborator> = {}): Collaborator {
  return { userId: "u-1", email: "a@example.com", role: "viewer", createdAt: 1, ...over };
}

async function flush() {
  await act(async () => {});
}

async function renderModal(open = true) {
  const onClose = vi.fn();
  render(<CollaboratorsModal open={open} graphId="g-1" graphName="我的产线" onClose={onClose} />);
  if (open) {
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("g-1"));
    await flush();
  }
  return { onClose };
}

describe("CollaboratorsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ collaborators: [] });
    mockPut.mockResolvedValue(undefined);
  });

  it("renders nothing when closed and does not fetch", () => {
    const { container } = render(
      <CollaboratorsModal open={false} graphId="g-1" graphName="x" onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("renders the title with the graph name", async () => {
    await renderModal();
    expect(screen.getByText("协作者 — 我的产线")).toBeInTheDocument();
  });

  it("shows the empty state when there are no collaborators", async () => {
    await renderModal();
    expect(screen.getByText("暂无协作者")).toBeInTheDocument();
  });

  it("renders collaborators with localized roles and an em dash for missing email", async () => {
    mockGet.mockResolvedValue({
      collaborators: [
        mkCollab({ userId: "u-1", email: "editor@example.com", role: "editor" }),
        mkCollab({ userId: "u-2", email: "viewer@example.com", role: "viewer" }),
        mkCollab({ userId: "u-3", email: null, role: "owner" }),
      ],
    });
    await renderModal();
    expect(screen.getByText("editor@example.com")).toBeInTheDocument();
    // role label also appears once in the role <select> option, hence 2 matches
    expect(screen.getAllByText("编辑者").length).toBe(2);
    expect(screen.getByText("viewer@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("查看者").length).toBe(2);
    // unknown role renders the raw role string (no matching option)
    expect(screen.getByText("owner")).toBeInTheDocument();
  });

  it("keeps add disabled until an email is entered", async () => {
    await renderModal();
    const addBtn = screen.getByText("添加") as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("collaborator@example.com"), {
      target: { value: "new@example.com" },
    });
    expect(addBtn.disabled).toBe(false);
  });

  it("adds a collaborator with the selected role and clears the input", async () => {
    await renderModal();
    fireEvent.change(screen.getByPlaceholderText("collaborator@example.com"), {
      target: { value: "new@example.com" },
    });
    // switch role to editor
    fireEvent.change(screen.getByDisplayValue("查看者"), { target: { value: "editor" } });
    fireEvent.click(screen.getByText("添加"));
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith("g-1", "new@example.com", "editor"),
    );
    // input cleared after add
    expect(
      (screen.getByPlaceholderText("collaborator@example.com") as HTMLInputElement).value,
    ).toBe("");
  });

  it("also adds on Enter when an email is present", async () => {
    await renderModal();
    const input = screen.getByPlaceholderText("collaborator@example.com");
    fireEvent.change(input, { target: { value: "enter@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith("g-1", "enter@example.com", "viewer"),
    );
  });

  it("removes a collaborator (null role)", async () => {
    mockGet.mockResolvedValue({ collaborators: [mkCollab({ email: "gone@example.com" })] });
    await renderModal();
    fireEvent.click(screen.getByText("移除"));
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith("g-1", "gone@example.com", null));
  });

  it("surfaces an error message when adding fails", async () => {
    mockPut.mockRejectedValue(new Error("用户不存在"));
    await renderModal();
    fireEvent.change(screen.getByPlaceholderText("collaborator@example.com"), {
      target: { value: "bad@example.com" },
    });
    fireEvent.click(screen.getByText("添加"));
    await waitFor(() => expect(screen.getByText(/用户不存在/)).toBeInTheDocument());
  });

  it("closes on Escape, backdrop and the footer button, not on modal body", async () => {
    const { onClose } = await renderModal();
    const footerClose = screen.getAllByText("关闭");
    fireEvent.click(document.querySelector(".modal")!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.querySelector(".modal-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(footerClose[0]);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
