import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SkillPicker from "./SkillPicker";
import type { Skill, SkillMount } from "@agent-world/core";

// Mock api
const mockListSkills = vi.fn();
vi.mock("../lib/api", () => ({
  api: {
    listSkills: () => mockListSkills(),
  },
}));

const sampleSkills: Skill[] = [
  {
    id: "skill-web",
    name: "网页浏览",
    description: "访问和解析网页内容",
    permissions: {
      network: { domains: ["*"] },
    },
  },
  {
    id: "skill-fs",
    name: "文件操作",
    description: "读写本地文件",
    permissions: {
      fs: { read: true, write: true },
    },
  },
  {
    id: "skill-shell",
    name: "命令执行",
    description: "执行 shell 命令",
    permissions: {
      subprocess: true,
    },
  },
  {
    id: "skill-env",
    name: "环境变量",
    description: "读取环境变量",
    permissions: {
      env: ["PATH", "HOME"],
    },
  },
  {
    id: "skill-simple",
    name: "简单技能",
    description: "无权限要求的技能",
    permissions: {},
  },
];

function renderComponent(mounted: SkillMount[] = [], onChange: (m: SkillMount[]) => void = vi.fn()) {
  return render(<SkillPicker mounted={mounted} onChange={onChange} />);
}

describe("SkillPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSkills.mockResolvedValue(sampleSkills);
  });

  describe("加载状态", () => {
    it("skills 为空时返回 null", () => {
      mockListSkills.mockReturnValue(new Promise(() => {}));
      const { container } = renderComponent();
      expect(container.firstChild).toBeNull();
    });

    it("api 调用失败时返回 null", async () => {
      mockListSkills.mockRejectedValue(new Error("API error"));
      const { container } = renderComponent();
      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });
  });

  describe("渲染", () => {
    it("显示'技能卡'标签", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getByText("技能卡")).toBeInTheDocument();
      });
    });

    it("渲染所有技能卡片", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getByText("网页浏览")).toBeInTheDocument();
        expect(screen.getByText("文件操作")).toBeInTheDocument();
        expect(screen.getByText("命令执行")).toBeInTheDocument();
        expect(screen.getAllByText("环境变量").length).toBeGreaterThan(0);
        expect(screen.getByText("简单技能")).toBeInTheDocument();
      });
    });

    it("显示技能描述", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getByText("访问和解析网页内容")).toBeInTheDocument();
        expect(screen.getByText("读写本地文件")).toBeInTheDocument();
      });
    });

    it("未装备的技能显示'装备'", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getAllByText("装备")).toHaveLength(5);
      });
    });

    it("已装备的技能显示'已装备'", async () => {
      const mounted: SkillMount[] = [
        { id: "skill-web", config: {}, enabled: true },
        { id: "skill-fs", config: {}, enabled: true },
      ];
      renderComponent(mounted);
      await waitFor(() => {
        expect(screen.getAllByText("已装备")).toHaveLength(2);
        expect(screen.getAllByText("装备")).toHaveLength(3);
      });
    });

    it("已装备的技能有 is-on class", async () => {
      const mounted: SkillMount[] = [
        { id: "skill-web", config: {}, enabled: true },
      ];
      renderComponent(mounted);
      await waitFor(() => {
        const cards = document.querySelectorAll(".skill-card");
        expect(cards[0]).toHaveClass("is-on");
        expect(cards[1]).not.toHaveClass("is-on");
      });
    });

    it("有 field class", async () => {
      renderComponent();
      await waitFor(() => {
        expect(document.querySelector(".field")).toBeInTheDocument();
      });
    });

    it("有 skill-list class", async () => {
      renderComponent();
      await waitFor(() => {
        expect(document.querySelector(".skill-list")).toBeInTheDocument();
      });
    });
  });

  describe("权限标签", () => {
    it("网络权限显示'网络'标签", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getByText("网络")).toBeInTheDocument();
      });
    });

    it("文件权限显示'文件'标签", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getByText("文件")).toBeInTheDocument();
      });
    });

    it("子进程权限显示'子进程'标签", async () => {
      renderComponent();
      await waitFor(() => {
        expect(screen.getByText("子进程")).toBeInTheDocument();
      });
    });

    it("环境变量权限显示'环境变量'标签", async () => {
      renderComponent();
      await waitFor(() => {
        const permBadges = screen.getAllByText("环境变量");
        // 至少有一个是权限标签（在 .perm-badge 中）
        const hasPermBadge = permBadges.some((el) => el.closest(".perm-badge"));
        expect(hasPermBadge).toBe(true);
      });
    });

    it("无权限的技能不显示权限标签", async () => {
      renderComponent();
      await waitFor(() => {
        const simpleCard = screen.getByText("简单技能").closest(".skill-card");
        expect(simpleCard?.querySelector(".skill-card__perms")).toBeNull();
      });
    });

    it("权限标签有 perm-badge class", async () => {
      renderComponent();
      await waitFor(() => {
        expect(document.querySelectorAll(".perm-badge").length).toBeGreaterThan(0);
      });
    });
  });

  describe("交互", () => {
    it("点击未装备的技能调用 onChange 添加", async () => {
      const onChange = vi.fn();
      renderComponent([], onChange);
      await waitFor(() => {
        expect(screen.getByText("网页浏览")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("网页浏览").closest(".skill-card")!);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([
        { id: "skill-web", config: {}, enabled: true },
      ]);
    });

    it("点击已装备的技能调用 onChange 移除", async () => {
      const onChange = vi.fn();
      const mounted: SkillMount[] = [
        { id: "skill-web", config: {}, enabled: true },
        { id: "skill-fs", config: {}, enabled: true },
      ];
      renderComponent(mounted, onChange);
      await waitFor(() => {
        expect(screen.getByText("网页浏览")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText("网页浏览").closest(".skill-card")!);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith([
        { id: "skill-fs", config: {}, enabled: true },
      ]);
    });

    it("多次点击切换装备状态", async () => {
      const onChange = vi.fn();
      renderComponent([], onChange);
      await waitFor(() => {
        expect(screen.getByText("网页浏览")).toBeInTheDocument();
      });
      // 第一次点击：装备
      fireEvent.click(screen.getByText("网页浏览").closest(".skill-card")!);
      expect(onChange).toHaveBeenLastCalledWith([
        { id: "skill-web", config: {}, enabled: true },
      ]);
    });

    it("disabled 的技能不被视为已装备", async () => {
      const mounted: SkillMount[] = [
        { id: "skill-web", config: {}, enabled: false },
      ];
      renderComponent(mounted);
      await waitFor(() => {
        expect(screen.getAllByText("装备").length).toBeGreaterThan(0);
      });
    });
  });

  describe("API 调用", () => {
    it("组件挂载时调用 api.listSkills", async () => {
      renderComponent();
      await waitFor(() => {
        expect(mockListSkills).toHaveBeenCalledTimes(1);
      });
    });

    it("api 返回空数组时返回 null", async () => {
      mockListSkills.mockResolvedValue([]);
      const { container } = renderComponent();
      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });
  });
});
