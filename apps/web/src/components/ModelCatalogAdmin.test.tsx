import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelCatalogAdmin } from "./ModelCatalogAdmin";

const getModelCatalog = vi.fn();
const putModelCatalog = vi.fn();

vi.mock("../lib/api", () => ({
  api: {
    getModelCatalog: () => getModelCatalog(),
    putModelCatalog: (c: unknown) => putModelCatalog(c),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key) }),
}));

const VIEW = {
  providers: {
    agnes: {
      type: "openai-compatible",
      models: ["agnes-2.0-flash", "agnes-video-v2.0"],
      modalities: { "agnes-2.0-flash": "text", "agnes-video-v2.0": "video" },
      pricing: { "agnes-2.0-flash": { input: 0.15, output: 0.6 } },
      enabled: true,
      hasKey: true,
    },
  },
  overlay: {},
  code: {
    agnes: {
      type: "openai-compatible",
      models: ["agnes-2.0-flash", "agnes-video-v2.0"],
      modalities: {},
      pricing: {},
      enabled: true,
      hasKey: true,
    },
  },
  gaps: [],
};

beforeEach(() => {
  getModelCatalog.mockReset();
  putModelCatalog.mockReset();
});

describe("ModelCatalogAdmin", () => {
  it("renders nothing for an account that is not a catalog admin", async () => {
    // 403 在 api 层归一成 null：这一屏不该为普通用户存在，也不该报错。
    getModelCatalog.mockResolvedValue(null);
    const { container } = render(<ModelCatalogAdmin />);
    await waitFor(() => expect(getModelCatalog).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the shipped catalog and keeps save disabled until something changes", async () => {
    getModelCatalog.mockResolvedValue(VIEW);
    render(<ModelCatalogAdmin />);
    // 模型名是可编辑输入框，不是静态文本
    expect(await screen.findByDisplayValue("agnes-2.0-flash")).toBeInTheDocument();
    expect(screen.getByDisplayValue("agnes-video-v2.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings:modelKeys.catalogSave" })).toBeDisabled();
  });

  it("edits a unit price and PUTs the overlay only", async () => {
    const user = userEvent.setup();
    getModelCatalog.mockResolvedValue(VIEW);
    putModelCatalog.mockResolvedValue({
      ok: true,
      view: { ...VIEW, overlay: { agnes: { pricing: { "agnes-2.0-flash": { input: 9, output: 0.6 } } } } },
      changes: [{ provider: "agnes", added: [], removed: [], modalityEdited: [], priceEdited: ["agnes-2.0-flash"], enabledChanged: false }],
      affected: [],
      affectedTruncated: false,
    });
    render(<ModelCatalogAdmin />);
    // 字段标签来自 core 的 PRICING_FIELDS（与 Settings 里既有的单价输入框同源）
    const price = await screen.findByPlaceholderText("输入 / 1M token");
    await user.clear(price);
    await user.type(price, "9");
    await user.click(screen.getByRole("button", { name: "settings:modelKeys.catalogSave" }));
    await waitFor(() => expect(putModelCatalog).toHaveBeenCalledTimes(1));
    const sent = putModelCatalog.mock.calls[0]![0] as Record<string, { pricing: Record<string, unknown> }>;
    // 整张价格卡一起写回：overlay 的 pricing 是替换语义，只发 {input} 会把
    // 没动过的 output 单价静默清零 —— 那正是"改了 A 坏了 B"的账目缺陷。
    expect(sent.agnes.pricing["agnes-2.0-flash"]).toEqual({ input: 9, output: 0.6 });
  });

  it("retiring a model surfaces the pipelines that will break", async () => {
    const user = userEvent.setup();
    getModelCatalog.mockResolvedValue(VIEW);
    putModelCatalog.mockResolvedValue({
      ok: true,
      view: { ...VIEW, overlay: { agnes: { models: ["agnes-2.0-flash"] } } },
      changes: [{ provider: "agnes", added: [], removed: ["agnes-video-v2.0"], modalityEdited: [], priceEdited: [], enabledChanged: false }],
      affected: [{ graphId: "g1", graphName: "短视频广告工坊", models: ["agnes-video-v2.0"], nodes: ["出片"] }],
      affectedTruncated: false,
    });
    render(<ModelCatalogAdmin />);
    await screen.findByDisplayValue("agnes-2.0-flash");
    await user.click(screen.getAllByRole("button", { name: "settings:modelKeys.catalogRemoveModel" })[1]!);
    await user.click(screen.getByRole("button", { name: "settings:modelKeys.catalogSave" }));
    expect(await screen.findByText(/短视频广告工坊/)).toBeInTheDocument();
    expect(screen.getByText(/settings:modelKeys.catalogAffected:\{"count":1\}/)).toBeInTheDocument();
  });

  it("warns about models that would be metered as zero", async () => {
    getModelCatalog.mockResolvedValue({
      ...VIEW,
      gaps: [{ provider: "agnes", model: "agnes-video-v2.0", modality: "video", level: "none", missing: ["perSecond"] }],
    });
    render(<ModelCatalogAdmin />);
    expect(await screen.findByText(/settings:modelKeys.catalogGaps:\{"models":"agnes-video-v2\.0"\}/)).toBeInTheDocument();
  });
});
