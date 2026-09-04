import { render, screen, fireEvent, within } from "@testing-library/react";
import ConnectorEditor from "./ConnectorEditor";
import type { ConnectorConfig } from "@agent-world/core";

// Mock Tooltip
vi.mock("./Tooltip", () => ({
  default: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <span title={content}>{children}</span>
  ),
}));

const mockOnChange = vi.fn();
const mockOnBeginEdit = vi.fn();
const mockOnCommitEdit = vi.fn();

function renderEditor(connector?: ConnectorConfig) {
  return render(
    <ConnectorEditor
      connector={connector}
      onChange={mockOnChange}
      onBeginEdit={mockOnBeginEdit}
      onCommitEdit={mockOnCommitEdit}
    />,
  );
}

describe("ConnectorEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("渲染", () => {
    it("显示标题'数据源接入（Connector）'", () => {
      renderEditor();
      expect(screen.getByText("数据源接入（Connector）")).toBeInTheDocument();
    });

    it("显示接入方式下拉框", () => {
      renderEditor();
      expect(screen.getByLabelText("接入方式")).toBeInTheDocument();
    });

    it("默认选中'无（用下方「创作简报 / 原始物料」）'", () => {
      renderEditor();
      const select = screen.getByLabelText("接入方式") as HTMLSelectElement;
      expect(select.value).toBe("none");
    });

    it("下拉框包含所有 6 种接入方式", () => {
      renderEditor();
      const select = screen.getByLabelText("接入方式");
      const options = within(select).getAllByRole("option");
      expect(options).toHaveLength(6);
      expect(options[0]).toHaveValue("none");
      expect(options[1]).toHaveValue("file");
      expect(options[2]).toHaveValue("http");
      expect(options[3]).toHaveValue("form");
      expect(options[4]).toHaveValue("database");
      expect(options[5]).toHaveValue("product");
    });

    it("无 connector 时不显示测试连接按钮", () => {
      renderEditor();
      expect(screen.queryByRole("button", { name: "测试连接" })).not.toBeInTheDocument();
    });
  });

  describe("切换接入方式", () => {
    it("选择 file 调用 onChange 传入 file connector 默认值", () => {
      renderEditor();
      const select = screen.getByLabelText("接入方式");
      fireEvent.change(select, { target: { value: "file" } });
      expect(mockOnChange).toHaveBeenCalledWith({
        type: "file",
        file: { path: "", encoding: "utf8", asImages: false },
      });
    });

    it("选择 http 调用 onChange 传入 http connector 默认值", () => {
      renderEditor();
      const select = screen.getByLabelText("接入方式");
      fireEvent.change(select, { target: { value: "http" } });
      expect(mockOnChange).toHaveBeenCalledWith({
        type: "http",
        http: { url: "", method: "GET" },
      });
    });

    it("选择 form 调用 onChange 传入 form connector 默认值", () => {
      renderEditor();
      const select = screen.getByLabelText("接入方式");
      fireEvent.change(select, { target: { value: "form" } });
      expect(mockOnChange).toHaveBeenCalledWith({
        type: "form",
        form: { fields: [] },
      });
    });

    it("选择 database 调用 onChange 传入 database connector 默认值", () => {
      renderEditor();
      const select = screen.getByLabelText("接入方式");
      fireEvent.change(select, { target: { value: "database" } });
      expect(mockOnChange).toHaveBeenCalledWith({
        type: "database",
        database: { driver: "sqlite", path: "", query: "SELECT * FROM ", format: "json" },
      });
    });

    it("从有 connector 切回 none 调用 onChange(undefined)", () => {
      renderEditor({ type: "file", file: { path: "/data.txt", encoding: "utf8", asImages: false } });
      const select = screen.getByLabelText("接入方式");
      fireEvent.change(select, { target: { value: "none" } });
      expect(mockOnChange).toHaveBeenCalledWith(undefined);
    });
  });

  describe("File 连接器", () => {
    const fileConnector: ConnectorConfig = {
      type: "file",
      file: { path: "/data/input.txt", encoding: "utf8", asImages: false },
    };

    it("显示路径/glob 输入框", () => {
      renderEditor(fileConnector);
      expect(screen.getByLabelText("路径 / glob")).toBeInTheDocument();
    });

    it("路径输入框显示当前值", () => {
      renderEditor(fileConnector);
      const input = screen.getByLabelText("路径 / glob") as HTMLInputElement;
      expect(input.value).toBe("/data/input.txt");
    });

    it("修改路径调用 onChange", () => {
      renderEditor(fileConnector);
      const input = screen.getByLabelText("路径 / glob");
      fireEvent.change(input, { target: { value: "/new/path.txt" } });
      expect(mockOnChange).toHaveBeenCalledWith({
        type: "file",
        file: { path: "/new/path.txt", encoding: "utf8", asImages: false },
      });
    });

    it("显示'作为图片'复选框", () => {
      renderEditor(fileConnector);
      expect(screen.getByText("作为图片（不读文本，把路径作为附图喂下游）")).toBeInTheDocument();
    });

    it("勾选'作为图片'调用 onChange", () => {
      renderEditor(fileConnector);
      const checkbox = screen.getByRole("checkbox");
      fireEvent.click(checkbox);
      expect(mockOnChange).toHaveBeenCalledWith({
        type: "file",
        file: { path: "/data/input.txt", encoding: "utf8", asImages: true },
      });
    });

    it("显示 glob 语法提示", () => {
      renderEditor(fileConnector);
      expect(screen.getByText(/支持/)).toBeInTheDocument();
      expect(screen.getByText("*")).toBeInTheDocument();
      expect(screen.getByText("?")).toBeInTheDocument();
      expect(screen.getByText("**")).toBeInTheDocument();
    });

    it("显示测试连接按钮", () => {
      renderEditor(fileConnector);
      expect(screen.getByRole("button", { name: "测试连接" })).toBeInTheDocument();
    });
  });

  describe("HTTP 连接器", () => {
    const httpConnector: ConnectorConfig = {
      type: "http",
      http: { url: "https://api.example.com/data", method: "GET" },
    };

    it("显示方法下拉框", () => {
      renderEditor(httpConnector);
      expect(screen.getByLabelText("方法")).toBeInTheDocument();
    });

    it("方法下拉框包含 GET 和 POST", () => {
      renderEditor(httpConnector);
      const select = screen.getByLabelText("方法");
      const options = within(select).getAllByRole("option");
      expect(options).toHaveLength(2);
      expect(options[0]).toHaveValue("GET");
      expect(options[1]).toHaveValue("POST");
    });

    it("显示 URL 输入框", () => {
      renderEditor(httpConnector);
      expect(screen.getByLabelText("URL")).toBeInTheDocument();
    });

    it("URL 输入框显示当前值", () => {
      renderEditor(httpConnector);
      const input = screen.getByLabelText("URL") as HTMLInputElement;
      expect(input.value).toBe("https://api.example.com/data");
    });

    it("修改 URL 调用 onChange", () => {
      renderEditor(httpConnector);
      const input = screen.getByLabelText("URL");
      fireEvent.change(input, { target: { value: "https://new.api.com/data" } });
      expect(mockOnChange).toHaveBeenCalledWith({
        type: "http",
        http: { url: "https://new.api.com/data", method: "GET" },
      });
    });

    it("显示鉴权下拉框", () => {
      renderEditor(httpConnector);
      expect(screen.getByLabelText("鉴权")).toBeInTheDocument();
    });

    it("显示测试连接按钮", () => {
      renderEditor(httpConnector);
      expect(screen.getByRole("button", { name: "测试连接" })).toBeInTheDocument();
    });
  });

  describe("Form 连接器", () => {
    const formConnector: ConnectorConfig = {
      type: "form",
      form: {
        fields: [
          { name: "name", label: "姓名", required: true },
          { name: "email", label: "邮箱", required: false },
        ],
      },
    };

    it("显示字段名输入框（含当前值）", () => {
      renderEditor(formConnector);
      const nameInputs = screen.getAllByPlaceholderText("字段名(name)");
      expect(nameInputs).toHaveLength(2);
      expect(nameInputs[0]).toHaveValue("name");
      expect(nameInputs[1]).toHaveValue("email");
    });

    it("显示字段 label 输入框（含当前值）", () => {
      renderEditor(formConnector);
      const labelInputs = screen.getAllByPlaceholderText("显示(label)");
      expect(labelInputs).toHaveLength(2);
      expect(labelInputs[0]).toHaveValue("姓名");
      expect(labelInputs[1]).toHaveValue("邮箱");
    });

    it("显示必填复选框", () => {
      renderEditor(formConnector);
      const checkboxes = screen.getAllByRole("checkbox");
      // 第一个字段必填，第二个非必填
      expect(checkboxes[0]).toBeChecked();
      expect(checkboxes[1]).not.toBeChecked();
    });

    it("显示添加字段按钮", () => {
      renderEditor(formConnector);
      expect(screen.getByRole("button", { name: "+ 添加字段" })).toBeInTheDocument();
    });

    it("显示字段说明提示", () => {
      renderEditor(formConnector);
      expect(screen.getByText(/运行产线前会弹出此表单/)).toBeInTheDocument();
    });

    it("显示测试连接按钮", () => {
      renderEditor(formConnector);
      expect(screen.getByRole("button", { name: "测试连接" })).toBeInTheDocument();
    });
  });

  describe("Database 连接器", () => {
    const dbConnector: ConnectorConfig = {
      type: "database",
      database: { driver: "sqlite", path: "/data/app.db", query: "SELECT * FROM users", format: "json" },
    };

    it("显示数据库路径输入框", () => {
      renderEditor(dbConnector);
      expect(screen.getByLabelText("SQLite 数据库文件路径")).toBeInTheDocument();
    });

    it("数据库路径输入框显示当前值", () => {
      renderEditor(dbConnector);
      const input = screen.getByLabelText("SQLite 数据库文件路径") as HTMLInputElement;
      expect(input.value).toBe("/data/app.db");
    });

    it("显示 SQL 查询文本域", () => {
      renderEditor(dbConnector);
      expect(screen.getByLabelText("查询（只读 SELECT，可带 ? 参数）")).toBeInTheDocument();
    });

    it("SQL 查询文本域显示当前值", () => {
      renderEditor(dbConnector);
      const textarea = screen.getByLabelText("查询（只读 SELECT，可带 ? 参数）") as HTMLTextAreaElement;
      expect(textarea.value).toBe("SELECT * FROM users");
    });

    it("显示输出格式下拉框", () => {
      renderEditor(dbConnector);
      expect(screen.getByLabelText("输出格式")).toBeInTheDocument();
    });

    it("输出格式下拉框包含 JSON 和 CSV", () => {
      renderEditor(dbConnector);
      const select = screen.getByLabelText("输出格式");
      const options = within(select).getAllByRole("option");
      expect(options).toHaveLength(2);
      expect(options[0]).toHaveValue("json");
      expect(options[1]).toHaveValue("csv");
    });

    it("显示测试连接按钮", () => {
      renderEditor(dbConnector);
      expect(screen.getByRole("button", { name: "测试连接" })).toBeInTheDocument();
    });
  });

  describe("测试连接", () => {
    const fileConnector: ConnectorConfig = {
      type: "file",
      file: { path: "/data/input.txt", encoding: "utf8", asImages: false },
    };

    it("点击测试连接调用 fetch /api/connectors/test", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: "hello", images: [], fullLength: 5 }),
      });
      vi.stubGlobal("fetch", mockFetch);

      renderEditor(fileConnector);
      fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

      expect(mockFetch).toHaveBeenCalledWith("/api/connectors/test", expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }));
    });

    it("测试成功显示结果", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: "hello world", images: [], fullLength: 11 }),
      });
      vi.stubGlobal("fetch", mockFetch);

      renderEditor(fileConnector);
      fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

      await screen.findByText(/成功 · 文本 11 字符/);
      expect(screen.getByText("hello world")).toBeInTheDocument();
    });

    it("测试成功且有图片时显示图片数量", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: "data", images: ["img1", "img2"], fullLength: 4 }),
      });
      vi.stubGlobal("fetch", mockFetch);

      renderEditor(fileConnector);
      fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

      await screen.findByText(/成功 · 文本 4 字符 · 图片 2 张/);
    });

    it("测试失败显示错误信息", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "文件不存在" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      renderEditor(fileConnector);
      fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

      await screen.findByText(/失败：文件不存在/);
    });

    it("测试中按钮显示'测试中…'且禁用", async () => {
      let resolveFetch: (value: unknown) => void;
      const mockFetch = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      );
      vi.stubGlobal("fetch", mockFetch);

      renderEditor(fileConnector);
      const btn = screen.getByRole("button", { name: "测试连接" });
      fireEvent.click(btn);

      expect(screen.getByRole("button", { name: "测试中…" })).toBeDisabled();

      // 完成 fetch 避免警告
      resolveFetch!({
        ok: true,
        json: () => Promise.resolve({ text: "", images: [], fullLength: 0 }),
      });
    });

    it("空结果显示'(空)'", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: "", images: [], fullLength: 0 }),
      });
      vi.stubGlobal("fetch", mockFetch);

      renderEditor(fileConnector);
      fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

      await screen.findByText("(空)");
    });
  });
});
