import { useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface GlossaryRow {
  std: string;
  game: string;
  note?: string;
}

interface GlossaryGroup {
  id: string;
  title: string;
  rows: GlossaryRow[];
}

/** 术语对照数据，与 docs/design-glossary.md 保持一致。 */
const GROUPS: GlossaryGroup[] = [
  {
    id: "core",
    title: "核心实体",
    rows: [
      { std: "Graph / Flow（一张编排）", game: "产线", note: "一张工作流图" },
      { std: "Node（节点）", game: "文坊 / 站 / 工位", note: "计数用「座文坊」" },
      { std: "Agent node", game: "文坊", note: "加工原料的核心节点" },
      { std: "Gate node", game: "质检站", note: "质量检验节点" },
      { std: "Source node", game: "原料台（投料口）", note: "产线起点" },
      { std: "Sink node", game: "成品库 / 成品仓", note: "产线终点，成品交付" },
      { std: "Edge（连线）", game: "管道", note: "节点间的连接" },
      { std: "Packet（节点间传递的数据单元）", game: "卡车 / 在途货物", note: "沿管道运输的货单" },
      { std: "Artifact（节点产出）", game: "产物 / 成品", note: "画廊里叫「成品」" },
      { std: "Skill（能力）", game: "技能卡 / 装备", note: "不设解锁成本" },
    ],
  },
  {
    id: "nodekinds",
    title: "节点类型明细",
    rows: [
      { std: "textGen", game: "文坊", note: "LLM 加工" },
      { std: "gate", game: "质检站", note: "检验 / 返工判定" },
      { std: "source", game: "原料台", note: "投料" },
      { std: "sink", game: "成品库", note: "出料" },
      { std: "imageGen", game: "画坊", note: "文字 → 图片" },
      { std: "videoGen", game: "影坊", note: "文字 → 视频" },
      { std: "audioGen", game: "音坊", note: "文字 → 语音 / 音乐" },
      { std: "generic", game: "多能坊", note: "自由选型 provider，按模态自动 dispatch" },
      { std: "http", game: "API 口岸", note: "调外部 REST API（API 口岸）" },
      { std: "code", game: "代码工坊", note: "沙箱跑 JS / Python" },
      { std: "branch", game: "分拣闸", note: "按表达式路由分支" },
      { std: "map", game: "改料台", note: "JSON 模板转换" },
      { std: "loop", game: "批处理站", note: "逐项执行下游子图" },
      { std: "parallel", game: "汇流站", note: "等全部分支后聚合" },
      { std: "table", game: "理货台", note: "解析 / 筛选 / 排序 / 聚合" },
      { std: "database", game: "总账房", note: "SQL 查询" },
      { std: "fileParse", game: "拆包台", note: "提取 PDF / Word / PPT" },
      { std: "translate", game: "翻译间", note: "译成目标语言" },
      { std: "ocr", game: "识图台", note: "识别图片文字" },
      { std: "convert", game: "换装台", note: "PDF 提图 / 图片格式转换" },
      { std: "search", game: "瞭望塔", note: "联网检索（瞭望塔）" },
      { std: "notify", game: "广播站", note: "发群 / 邮件" },
      { std: "vcs", game: "档案柜", note: "GitHub / GitLab" },
      { std: "human", game: "人工岗", note: "暂停产线等人工审核（人工岗）" },
      { std: "subprocess", game: "外包工坊", note: "调用另一张产线作函数（外包工坊）" },
    ],
  },
  {
    id: "nodecategories",
    title: "节点分组",
    rows: [
      { std: "generation", game: "AI 加工", note: "文坊(textGen) / 画坊(imageGen) / 影坊(videoGen) / 音坊(audioGen) / 多能坊(generic)" },
      { std: "control", game: "车间调度", note: "质检站 / 分拣闸 / 改料台 / 批处理站 / 汇流站 / 外包工坊" },
      { std: "data", game: "物料处理", note: "理货台 / 总账房 / 拆包台 / 换装台 / 翻译间 / 识图台 / 代码工坊" },
      { std: "integrations", game: "外接设备", note: "API 口岸 / 瞭望塔 / 广播站 / 档案柜 / 人工岗" },
      { std: "io", game: "投料出料", note: "原料台 / 成品库" },
    ],
  },
  {
    id: "edges",
    title: "关系与连线",
    rows: [
      { std: "flow edge", game: "正向管道", note: "「铺管道」" },
      { std: "rework edge", game: "返工线", note: "质检打回上游" },
      { std: "error edge", game: "容错线", note: "故障改走此线" },
      { std: "upstream / downstream", game: "上游 / 下游", note: "前驱 / 后继节点" },
    ],
  },
  {
    id: "run",
    title: "运行、调度与触发",
    rows: [
      { std: "run（一次执行）", game: "派发任务 / 开工", note: "UI 按钮「派发」" },
      { std: "trigger: manual", game: "手动派发", note: "" },
      { std: "trigger: cron", game: "定时派发", note: "如日报产线" },
      { std: "trigger: webhook", game: "钩子触发", note: "外部 POST 自动启动" },
      { std: "trigger: event", game: "事件联动", note: "完成后触发下游" },
      { std: "trigger: batch", game: "批量派发", note: "一次跑 N 条输入" },
      { std: "scheduler", game: "开工调度 / 车间调度", note: "定执行顺序与并行" },
      { std: "barrier / 汇合", game: "汇合点 / 并站", note: "等齐上游再触发" },
      { std: "worker", game: "工人", note: "接真实模型的引擎实现" },
    ],
  },
  {
    id: "quality",
    title: "质量、返工与人工",
    rows: [
      { std: "attempt", game: "返工次数", note: "打回会 +1" },
      { std: "maxAttempts", game: "返工次数上限", note: "" },
      { std: "criterion", game: "质检标准", note: "产出需满足的条件" },
      { std: "rework", game: "返工 / 打回", note: "质检不合格退回重写" },
      { std: "retry", game: "重试", note: "网络故障自动重试，≠ 返工" },
      { std: "onExhausted: pass", game: "放行", note: "" },
      { std: "onExhausted: scrap", game: "判废 / 报废", note: "" },
      { std: "onExhausted: halt", game: "停线（等待人工）", note: "" },
      { std: "minScore", game: "质量分门槛", note: "低于则直接打回" },
      { std: "minBrandCoverage", game: "品牌词覆盖率门槛", note: "" },
      { std: "halt", game: "停线 / 质检员", note: "人工介入" },
    ],
  },
  {
    id: "cost",
    title: "资源与成本",
    rows: [
      { std: "token usage", game: "电费", note: "LLM 用量折合" },
      { std: "cost（美元）", game: "电费 / 成本", note: "" },
      { std: "budget", game: "电力预算 / 电费上限", note: "超了拉闸" },
      { std: "power.tripped", game: "电力不足 · 全厂停机", note: "预算耗尽" },
      { std: "cached tokens", game: "缓存电量", note: "命中打折计费" },
    ],
  },
  {
    id: "data",
    title: "数据、产物与资产",
    rows: [
      { std: "input assembly", game: "下料 / 喂料", note: "把上游拼成入料" },
      { std: "inputPolicy: all/last/truncate/summary", game: "全量 / 仅最近 / 截断 / 摘要下料", note: "" },
      { std: "artifact type", game: "产物类型", note: "text / json / html / image / file / table" },
      { std: "跨运行产物画廊", game: "成品库", note: "历史成品集中地" },
      { std: "knowledge / memory", game: "知识库 / 档案室", note: "经验沉淀（可检索）" },
      { std: "brand terms", game: "品牌词库", note: "一键载入文坊" },
    ],
  },
  {
    id: "ext",
    title: "扩展与生态",
    rows: [
      { std: "connector", game: "原料来源 / 接头", note: "manual / file / http / form" },
      { std: "skill mount", game: "装备技能卡", note: "" },
      { std: "MCP tool", game: "MCP 工具卡", note: "自动成为技能卡" },
      { std: "template", game: "产线模板", note: "" },
      { std: "A/B test", game: "A/B 对照 / 手臂对比", note: "换 N 版 prompt 比质量" },
      { std: "graph version / snapshot", game: "产线版本 / 版本快照", note: "可回放复原" },
    ],
  },
  {
    id: "admin",
    title: "管理与审计",
    rows: [
      { std: "ControlPanel 模式", game: "选择 / 铺管道 / 返工线 / 容错线 / 拆除", note: "画布交互模式" },
      { std: "eval report", game: "质量评估", note: "通过率 / 返工 / 时长 / 质量分" },
      { std: "cost report", game: "成本报表", note: "按产线 / 文坊 / 日期拆解" },
      { std: "event stream", game: "事件流 / 运行快照", note: "可回放（时光机）" },
      { std: "replay", game: "回放", note: "拖时间轴重放" },
      { std: "runId", game: "批次 / 运行号", note: "一次派发的身份" },
    ],
  },
];

export default function GlossaryModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide glossary" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>术语对照表</h2>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>
        <div className="modal__body">
          <p className="muted glossary__intro">
            左侧为标准术语（行业通用 / 代码字段），右侧为 Agent World 的工厂系用词。UI 产品文案使用右侧；代码、API、文档使用左侧。
          </p>
          {GROUPS.map((g) => (
            <details key={g.id} className="glossary__group" open={g.id === "core"}>
              <summary>{g.title}</summary>
              <div className="glossary__table-wrap">
                <table className="glossary__table">
                  <thead>
                    <tr>
                      <th>标准术语</th>
                      <th>Agent World</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r, i) => (
                      <tr key={i}>
                        <td className="glossary__std">{r.std}</td>
                        <td className="glossary__game">{r.game}</td>
                        <td className="glossary__note">{r.note ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
          <p className="muted glossary__foot">
            完整版见 docs/design-glossary.md。路径规则：新增概念先在此表落位，找不到工厂位置的暂不做。
          </p>
        </div>
      </div>
    </div>
  );
}