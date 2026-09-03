import { render, screen, fireEvent } from "@testing-library/react";
import ProductBlocks from "./ProductBlocks";
import type { ProductDocument, ProductBlock } from "@agent-world/core";

// Mock proxyImageUrl
vi.mock("../lib/api", () => ({
  proxyImageUrl: vi.fn((url: string) => {
    if (!url) return null;
    if (url.startsWith("data:")) return url;
    return `/api/proxy?url=${encodeURIComponent(url)}`;
  }),
}));

const sampleDoc: ProductDocument = {
  platform: "xiaohongshu",
  title: "测试产品文档",
  blocks: [
    {
      type: "hero",
      title: "Hero 标题",
      subtitle: "Hero 副标题",
      image: "https://example.com/hero.jpg",
    },
    {
      type: "heading",
      text: "章节标题",
    },
    {
      type: "paragraph",
      text: "这是一段普通文本，包含 **粗体文字** 和普通文字。",
    },
    {
      type: "quote",
      text: "这是一段引用文字。",
    },
    {
      type: "bullets",
      items: ["第一项", "第二项 **加粗**", "第三项"],
    },
    {
      type: "specs",
      rows: [
        { name: "规格1", value: "值1" },
        { name: "规格2", value: "值2" },
      ],
    },
    {
      type: "image",
      src: "https://example.com/image.jpg",
      caption: "图片说明",
      align: "center",
      rounded: true,
      aspect: "1:1",
    },
    {
      type: "imageCards",
      layout: "grid",
      columns: 2,
      items: [
        { src: "https://example.com/card1.jpg", caption: "卡片1", title: "标题1" },
        { src: "https://example.com/card2.jpg", caption: "卡片2" },
      ],
    },
    {
      type: "cta",
      text: "立即购买",
    },
    {
      type: "divider",
    },
  ],
} as any;

function renderDoc(doc: ProductDocument = sampleDoc) {
  render(<ProductBlocks doc={doc} />);
}

describe("ProductBlocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("文档容器", () => {
    it("渲染 product-doc 容器", () => {
      renderDoc();
      expect(document.querySelector(".product-doc")).toBeInTheDocument();
    });

    it("使用 platform 作为 class 后缀", () => {
      renderDoc();
      expect(document.querySelector(".product-doc--xiaohongshu")).toBeInTheDocument();
    });

    it("platform 为空时使用 default", () => {
      const doc = { ...sampleDoc, platform: undefined } as any;
      renderDoc(doc);
      expect(document.querySelector(".product-doc--default")).toBeInTheDocument();
    });

    it("有 title 且无 hero 块时显示文档标题", () => {
      const doc = {
        ...sampleDoc,
        blocks: sampleDoc.blocks.filter((b) => b.type !== "hero"),
      } as any;
      renderDoc(doc);
      expect(screen.getByText("测试产品文档")).toBeInTheDocument();
      expect(document.querySelector(".pb-doc-title")).toBeInTheDocument();
    });

    it("有 hero 块时不显示文档标题", () => {
      renderDoc();
      expect(screen.queryByText("测试产品文档")).not.toBeInTheDocument();
    });
  });

  describe("hero 块", () => {
    it("渲染 hero 标题", () => {
      renderDoc();
      expect(screen.getByText("Hero 标题")).toBeInTheDocument();
      expect(document.querySelector(".pb-hero__title")).toBeInTheDocument();
    });

    it("渲染 hero 副标题", () => {
      renderDoc();
      expect(screen.getByText("Hero 副标题")).toBeInTheDocument();
      expect(document.querySelector(".pb-hero__subtitle")).toBeInTheDocument();
    });

    it("渲染 hero 图片", () => {
      renderDoc();
      const img = document.querySelector(".pb-hero__img") as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.src).toContain("/api/proxy?url=");
    });

    it("hero 无图片时不渲染图片", () => {
      const doc = {
        ...sampleDoc,
        blocks: [{ type: "hero", title: "无图 Hero" }],
      } as any;
      renderDoc(doc);
      expect(document.querySelector(".pb-hero__img")).not.toBeInTheDocument();
    });

    it("hero 无副标题时不渲染副标题", () => {
      const doc = {
        ...sampleDoc,
        blocks: [{ type: "hero", title: "无副标题 Hero" }],
      } as any;
      renderDoc(doc);
      expect(document.querySelector(".pb-hero__subtitle")).not.toBeInTheDocument();
    });
  });

  describe("heading 块", () => {
    it("渲染章节标题", () => {
      renderDoc();
      expect(screen.getByText("章节标题")).toBeInTheDocument();
      expect(document.querySelector(".pb-heading")).toBeInTheDocument();
    });
  });

  describe("paragraph 块", () => {
    it("渲染段落文本", () => {
      renderDoc();
      expect(screen.getByText(/这是一段普通文本/)).toBeInTheDocument();
      expect(document.querySelector(".pb-paragraph")).toBeInTheDocument();
    });

    it("渲染 **粗体** 为 strong 标签", () => {
      renderDoc();
      const strong = screen.getByText("粗体文字");
      expect(strong.tagName).toBe("STRONG");
    });
  });

  describe("quote 块", () => {
    it("渲染引用文本", () => {
      renderDoc();
      expect(screen.getByText("这是一段引用文字。")).toBeInTheDocument();
      expect(document.querySelector(".pb-quote")).toBeInTheDocument();
    });
  });

  describe("bullets 块", () => {
    it("渲染无序列表", () => {
      renderDoc();
      expect(document.querySelector(".pb-bullets")).toBeInTheDocument();
    });

    it("渲染所有列表项", () => {
      renderDoc();
      expect(screen.getByText("第一项")).toBeInTheDocument();
      expect(screen.getByText("第三项")).toBeInTheDocument();
    });

    it("列表项中的 **粗体** 渲染为 strong", () => {
      renderDoc();
      const strong = screen.getByText("加粗");
      expect(strong.tagName).toBe("STRONG");
    });
  });

  describe("specs 块", () => {
    it("渲染规格表格", () => {
      renderDoc();
      expect(document.querySelector(".pb-specs")).toBeInTheDocument();
    });

    it("渲染所有规格行", () => {
      renderDoc();
      expect(screen.getByText("规格1")).toBeInTheDocument();
      expect(screen.getByText("值1")).toBeInTheDocument();
      expect(screen.getByText("规格2")).toBeInTheDocument();
      expect(screen.getByText("值2")).toBeInTheDocument();
    });
  });

  describe("image 块", () => {
    it("渲染图片", () => {
      renderDoc();
      const figure = document.querySelector(".pb-image") as HTMLElement;
      expect(figure).toBeInTheDocument();
      const img = figure.querySelector("img") as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.src).toContain("/api/proxy?url=");
    });

    it("渲染图片说明", () => {
      renderDoc();
      expect(screen.getByText("图片说明")).toBeInTheDocument();
    });

    it("center 对齐时宽度为 70% 且居中", () => {
      renderDoc();
      const figure = document.querySelector(".pb-image") as HTMLElement;
      expect(figure.style.width).toBe("70%");
      expect(figure.style.marginLeft).toBe("auto");
      expect(figure.style.marginRight).toBe("auto");
    });

    it("rounded 为 true 时图片有圆角", () => {
      renderDoc();
      const figure = document.querySelector(".pb-image") as HTMLElement;
      const img = figure.querySelector("img") as HTMLImageElement;
      expect(img.style.borderRadius).toBe("14px");
    });

    it("aspect 为 1:1 时图片有 aspect-ratio", () => {
      renderDoc();
      const figure = document.querySelector(".pb-image") as HTMLElement;
      const img = figure.querySelector("img") as HTMLImageElement;
      expect(img.style.aspectRatio).toBe("1 / 1");
      expect(img.style.objectFit).toBe("cover");
    });

    it("left 对齐时宽度为 55% 且左对齐", () => {
      const doc = {
        ...sampleDoc,
        blocks: [{ type: "image", src: "https://example.com/img.jpg", align: "left" }],
      } as any;
      renderDoc(doc);
      const figure = document.querySelector(".pb-image") as HTMLElement;
      expect(figure.style.width).toBe("55%");
      expect(figure.style.alignSelf).toBe("flex-start");
    });

    it("right 对齐时宽度为 55% 且右对齐", () => {
      const doc = {
        ...sampleDoc,
        blocks: [{ type: "image", src: "https://example.com/img.jpg", align: "right" }],
      } as any;
      renderDoc(doc);
      const figure = document.querySelector(".pb-image") as HTMLElement;
      expect(figure.style.width).toBe("55%");
      expect(figure.style.alignSelf).toBe("flex-end");
    });

    it("指定 width 时使用指定宽度", () => {
      const doc = {
        ...sampleDoc,
        blocks: [{ type: "image", src: "https://example.com/img.jpg", width: 300 }],
      } as any;
      renderDoc(doc);
      const figure = document.querySelector(".pb-image") as HTMLElement;
      expect(figure.style.width).toBe("300px");
    });

    it("图片加载失败时显示 fallback", () => {
      renderDoc();
      const img = document.querySelector(".pb-image img") as HTMLImageElement;
      fireEvent.error(img);
      expect(screen.getByText("图片暂时无法加载")).toBeInTheDocument();
    });

    it("无图片说明时不渲染 figcaption", () => {
      const doc = {
        ...sampleDoc,
        blocks: [{ type: "image", src: "https://example.com/img.jpg" }],
      } as any;
      renderDoc(doc);
      const figure = document.querySelector(".pb-image") as HTMLElement;
      expect(figure.querySelector("figcaption")).not.toBeInTheDocument();
    });
  });

  describe("imageCards 块", () => {
    it("渲染图片卡片组", () => {
      renderDoc();
      expect(document.querySelector(".pb-cards")).toBeInTheDocument();
      expect(document.querySelector(".pb-cards--grid")).toBeInTheDocument();
    });

    it("渲染所有卡片", () => {
      renderDoc();
      const cards = document.querySelectorAll(".pb-card");
      expect(cards.length).toBe(2);
    });

    it("渲染卡片标题", () => {
      renderDoc();
      expect(screen.getByText("标题1")).toBeInTheDocument();
    });

    it("渲染卡片说明", () => {
      renderDoc();
      expect(screen.getByText("卡片1")).toBeInTheDocument();
      expect(screen.getByText("卡片2")).toBeInTheDocument();
    });

    it("columns 为 2 时设置 gridTemplateColumns", () => {
      renderDoc();
      const cards = document.querySelector(".pb-cards") as HTMLElement;
      expect(cards.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    });

    it("horizontal 布局时使用 pb-cards--horizontal class", () => {
      const doc = {
        ...sampleDoc,
        blocks: [
          {
            type: "imageCards",
            layout: "horizontal",
            items: [{ src: "https://example.com/card.jpg" }],
          },
        ],
      } as any;
      renderDoc(doc);
      expect(document.querySelector(".pb-cards--horizontal")).toBeInTheDocument();
    });

    it("卡片 span 为 2 时设置 gridColumn", () => {
      const doc = {
        ...sampleDoc,
        blocks: [
          {
            type: "imageCards",
            layout: "grid",
            columns: 2,
            items: [{ src: "https://example.com/card.jpg", span: 2 }],
          },
        ],
      } as any;
      renderDoc(doc);
      const card = document.querySelector(".pb-card") as HTMLElement;
      expect(card.style.gridColumn).toBe("span 2");
    });
  });

  describe("cta 块", () => {
    it("渲染 CTA 按钮", () => {
      renderDoc();
      expect(screen.getByText("立即购买")).toBeInTheDocument();
    });

    it("CTA 按钮为禁用状态", () => {
      renderDoc();
      const button = screen.getByText("立即购买").closest("button");
      expect(button).toBeDisabled();
    });

    it("渲染 pb-cta 容器", () => {
      renderDoc();
      expect(document.querySelector(".pb-cta")).toBeInTheDocument();
    });
  });

  describe("divider 块", () => {
    it("渲染分割线", () => {
      renderDoc();
      expect(document.querySelector(".pb-divider")).toBeInTheDocument();
    });
  });

  describe("未知块类型", () => {
    it("未知块类型渲染 null", () => {
      const doc = {
        platform: "default",
        blocks: [{ type: "unknown" }],
      } as any;
      renderDoc(doc);
      // 未知块类型不渲染任何 Block 元素
      expect(document.querySelector(".pb-hero")).not.toBeInTheDocument();
      expect(document.querySelector(".pb-heading")).not.toBeInTheDocument();
      expect(document.querySelector(".pb-paragraph")).not.toBeInTheDocument();
    });
  });
});
