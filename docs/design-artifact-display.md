# 产物多态展示方案（Artifact Display Redesign）

> 状态：**已落地**（前端 2026-08-28 完成，commit 与验收见 [handoff.md](../handoff.md)）。本文档只保留设计，实施进度以 handoff 为准。
> 目标：让"各种流水线、各种产物"在画布/Inspector/成品面板/画廊里**一致且可扩展**地展示。
> 结论：**数据模型已多态，前端也已能渲染 image/video/audio/uri；真正缺的是"单一渲染真相源 + 统一卡外壳 + json/text 专门渲染 + 成本/失败态"。**

---

## 0. 结论速览

| 维度 | 现状 | 本方案 |
|---|---|---|
| 产物模型（schema） | ✅ 已多态 7 种 kind | 不变 |
| 画廊（ProductGallery） | ✅ 全 kind 过滤 chip 已有 | 复用其 filter，内部改挂 `ArtifactCard` |
| Inspector / 成品面板 | ⚠️ 手写 if/else 分支，3 处重复 | 统一走 `ArtifactCard` + `artifactRenderers` |
| json 渲染 | ❌ 仅链接 / `<pre>` | 新增 JSON 树/表格渲染器 |
| text 渲染 | ⚠️ `<pre>` 裸文本 | 按 `mimeType` 走 Markdown / product-html |
| 统一卡外壳 | ❌ 每处各写 | 新增 `ArtifactCard`（标签/类型色/size/成本/失败/下载复制） |
| 成本 / 失败态 | ❌ 无 | 卡外壳内置徽标 |

**后端 / schema 零改动。** 纯前端重构 + 一个渲染器注册表。

---

## 1. 现状与差距（已逐文件核实）

| 组件 | 位置 | 当前能力 | 差距 |
|---|---|---|---|
| `ProductGallery` | `apps/web/src/components/ProductGallery.tsx` | `FILTERS`（21）含全部 kind；`GalleryCard`（134）渲染 image/video/audio/file/uri | 内部渲染与 Inspector 重复；json 走兜底链接 |
| `Inspector.ArtifactChip` | `apps/web/src/components/Inspector.tsx:1104` | image/video/audio/uri + text 兜底 `<pre>`（1135） | json/file 无专门渲染；无成本/失败态 |
| `FinishedProduct` | `apps/web/src/components/FinishedProduct.tsx:106` | 分 images/videos/audios/others 手写 map 块（204-242） | 重复逻辑；others 仅链接；无统一卡 |
| 节点缩略图 | `apps/web/src/canvas/Plants.tsx` | 无 | 视觉类产物（图/视频）可在节点上预览 |

**根因**：`ArtifactKind` 分发逻辑散落在 3+ 个组件，每加一种 kind 要改 3 处；且 `json`/`text` 缺少"好看"的渲染器。

---

## 2. 设计目标与原则

1. **单一真相源（DRY）**：所有 kind 的渲染逻辑只在 `artifactRenderers` 注册表里写一次。
2. **可扩展**：新增一种产物类型 = 在枚举加一个值 + 注册一个渲染器组件；**布局/调用方零改动**。
3. **一致体验**：所有展示面复用同一个 `ArtifactCard` 外壳（标签、类型色条、size、成本、状态、操作）。
4. **不碰后端**：复用现有 `Artifact` schema（`packages/core/src/artifact.ts:19`）与 `ARTIFACT_COLORS`（59）。

---

## 3. 产物模型（已有，不改）

`packages/core/src/artifact.ts`：
- 枚举 `ArtifactKind`：`text | image | video | audio | file | json | uri`（8-16）
- 字段：`id, kind, mimeType?, content?, uri?, label?, sizeBytes?, metadata?`（19-34）
- `ARTIFACT_COLORS`：按 kind 上色（59-67）
- `extractArtifacts`（73-131）：已从文本抽取 image/video/audio/json

**text 子类型用 `mimeType` 分发**（不新增枚举值）：
- `text/markdown` → Markdown 渲染器
- `text/html` → 复用现有 `product-html.ts`（`productToHtml`）渲染营销成品
- 缺省 → 纯文本 / 代码块

---

## 4. 渲染器注册表设计

新建 `apps/web/src/lib/artifact-renderers.tsx`：

```tsx
import type { Artifact, ArtifactKind } from "@agent-world/core";

export type ArtifactRenderer = (a: ArtifactLike) => React.ReactNode;

// 兼容运行时 Artifact 与落库 StoredArtifact（取公共字段）
export type ArtifactLike = Pick<Artifact, "kind" | "uri" | "content" | "label" | "mimeType" | "sizeBytes" | "metadata"> & {
  id: string;
  status?: "ok" | "failed";
  cost?: number;            // 关联 usage 事件的成本（见 §6）
  createdAt?: string;
};

export const artifactRenderers: Record<ArtifactKind, ArtifactRenderer> = {
  text:  TextArtifact,    // mimeType 分派：markdown / html(product-html) / plain
  image: ImageArtifact,   // 缩略图 + 点击放大 + 下载
  video: VideoArtifact,   // <video controls>
  audio: AudioArtifact,   // <audio controls>
  file:  FileArtifact,    // 下载卡（图标+文件名+size）
  json:  JsonArtifact,    // 可折叠 JSON 树 / 表格视图
  uri:   UriArtifact,     // 外链卡片
};
```

各 kind 渲染规格：

| kind | 渲染器 | 行为 |
|---|---|---|
| `text` | `TextArtifact` | `mimeType==text/markdown`→Markdown；`text/html`→`productToHtml`；否则 `<pre>` |
| `image` | `ImageArtifact` | `<img loading=lazy>` + 点击开 lightbox + 下载按钮 |
| `video` | `VideoArtifact` | `<video controls preload=metadata>` |
| `audio` | `AudioArtifact` | `<audio controls>` |
| `file` | `FileArtifact` | 类型图标 + 文件名 + `sizeBytes` + 下载（已有 resolveUrl 逻辑复用） |
| `json` | `JsonArtifact` | 可折叠树（自写轻量递归组件，无需引入大依赖）；超长折叠 |
| `uri` | `UriArtifact` | 外链卡片 + 打开 ↗ |

---

## 5. 统一卡外壳 `ArtifactCard`

```tsx
export function ArtifactCard({ a, showMeta = true }: { a: ArtifactLike; showMeta?: boolean }) {
  const color = ARTIFACT_COLORS[a.kind];
  return (
    <div className={`artifact-card artifact-card--${a.kind}`} data-status={a.status}>
      <div className="artifact-card__bar" style={{ background: color }} />
      <div className="artifact-card__body">{artifactRenderers[a.kind](a)}</div>
      {showMeta && (
        <div className="artifact-card__meta">
          <span>{a.label ?? artifactLabel(a)}</span>
          {a.sizeBytes ? <span>{formatSize(a.sizeBytes)}</span> : null}
          {a.cost != null ? <span className="cost">¥{a.cost.toFixed(4)}</span> : null}
          {a.status === "failed" ? <span className="failed">生成失败</span> : null}
          <span className="actions">
            {a.uri && <a href={a.uri} download>下载</a>}
            {a.content && <button onClick={() => copy(a.content!)}>复制</button>}
          </span>
        </div>
      )}
    </div>
  );
}
```

外壳内置：类型色条、标签、`sizeBytes`、成本徽标、失败态、`下载/复制`。对所有 kind 自动生效。

---

## 6. 成本与失败态接入（不改后端，仅前端 join）

- **成本**：`artifact.produced` 事件已带 `nodeId`/`runId`；usage 事件带 `perImage` 等单价。前端在渲染时按 `runId+nodeId` 关联取成本，填 `ArtifactLike.cost`。无关联则不显示（不报错）。
- **失败态**：`engine.ts` 生图失败静默降级（标 done、$0）。方案在 `artifact` 上补 `status: "failed"`（来自 usage 中 cost=0 且节点为 imageGen 的推断，或后续引擎补 `artifact.failed` 标记）。本方案先预留 `status` 字段与标红样式，精确失败来源作为后续小步。

---

## 7. 三处展示面改造（调用方零逻辑）

| 文件 | 改法 |
|---|---|
| `Inspector.tsx:1104` `ArtifactChip` | 整函数替换为 `<ArtifactCard a={artifact} />`；删除手写 image/video/audio/uri/text 分支 |
| `FinishedProduct.tsx:204-242` | `images/videos/audios/others` 四个 map 块合并为 `artifacts.map(a => <ArtifactCard a={a} />)`；保留顶部"导出 HTML/MD/长图"按钮（作用于 sink 文本） |
| `ProductGallery.tsx:134` `GalleryCard` | 内部 `gallery-card__media` 分支替换为 `<ArtifactCard a={a} />`；**保留其 `FILTERS` 过滤 chip（已实现且完整）** |
| `canvas/Plants.tsx`（增强） | 节点右下角：image/video 画缩略图，其余画类型图标（复用 `ARTIFACT_COLORS`） |

---

## 8. 实施步骤（分阶段）

**Phase A — 注册表与外壳（核心，低风险）**
1. 新建 `apps/web/src/lib/artifact-renderers.tsx`：`ArtifactCard` + 7 个渲染器（json 树自写，text 接 Markdown）。
2. 引入轻量 Markdown 渲染：若无现成依赖，加 `react-markdown`（搜索 `package.json` 确认当前为 0 匹配，需新增）；或写极简 `#/**/link` 渲染。
3. 加 `artifact-card.css`（色条/失败标红/操作）。

**Phase B — 三处接入**
4. `Inspector.ArtifactChip` → `ArtifactCard`。
5. `FinishedProduct` 四个 map → `ArtifactCard`。
6. `ProductGallery.GalleryCard` → `ArtifactCard`（filter 保留）。

**Phase C — 增强**
7. 成本徽标：usage 事件 join。
8. 失败标红 + 节点/卡上"重做"入口（复用质检站 gate）。
9. A/B 对比：同节点多产物 → 卡内轮播/分页。

**Phase D — 节点缩略图（可选）**
10. `Plants.tsx` 视觉类产物缩略图。

---

## 9. 验收标准

- [ ] 一条产线产出 image/video/audio/json/file/text/uri 任意组合，在 **Inspector、成品面板、画廊** 三处均正确渲染，且样式一致。
- [ ] 新增一种 `kind`（如 `csv`）只需：枚举加值 + 注册一个渲染器；三处展示面无需改动即生效。
- [ ] `json` 产物显示为可折叠树（非裸链接/`<pre>`）。
- [ ] `text`(markdown) 产物显示为格式化 Markdown。
- [ ] 任意产物卡显示 label / 类型色 / size；有成本时显示成本徽标；失败产物标红。
- [ ] 画廊的 kind 过滤 chip 仍可用（未破坏）。
- [ ] 后端 / `Artifact` schema 无改动；无新增破坏性依赖（或仅新增 `react-markdown`）。

---

## 10. 风险与权衡

- **`Artifact` vs `StoredArtifact` 字段差**：`StoredArtifact` 多 `createdAt/runId`。渲染器取公共字段，调用方负责把 `cost/status/createdAt` 映射进 `ArtifactLike`。
- **Markdown 依赖**：当前 `package.json` 无 markdown 库（搜索 0 匹配）。建议加 `react-markdown`（小、流行）；或自写极简渲染避免加依赖。
- **大 json / 长视频性能**：JSON 树超 500 节点折叠；视频 `preload=metadata`。
- **成本 join 准确性**：先"有则显示"，避免因 join 失败导致卡不渲染。

---

## 11. 未来扩展

- 新 kind：`csv`（表格）、`embedding`、`model(3d)` → 枚举加值 + 注册渲染器，布局不动。
- 产物对比视图：同 prompt 多模型产出并排。
- 产物搜索 / 跨 run 时间线。

---

### 附：关键文件索引
- 模型：`packages/core/src/artifact.ts`（枚举 8 / schema 19 / 颜色 59 / 抽取 73）
- 注册表：`apps/web/src/lib/artifact-renderers.tsx`（**新增**：`ArtifactCard` + `artifactRenderers` + JSON 树 + 共享 `renderMarkdown`）
- 画廊：`apps/web/src/components/ProductGallery.tsx`（FILTERS 21 / GalleryCard 134 已挂 `ArtifactCard`）
- Inspector：`apps/web/src/components/Inspector.tsx`（原 `ArtifactChip` 已删除，调用处改挂 `ArtifactCard`）
- 成品：`apps/web/src/components/FinishedProduct.tsx`（collect 111 / 四个 map 已合并为 `ArtifactCard` 网格；本地 `renderMarkdown` 已提升为共享）
- 成品 HTML：`apps/web/src/lib/product-html.ts`（`productToHtml` / `productToLongImage`）
- 样式：`apps/web/src/styles.css`（新增 `.artifact-card` / `.json-view` / `.product__artifacts`）
- 卡车着色：`apps/web/src/canvas/PacketLayer.tsx:97`（已按 artifactKind 上色，与方案一致）

---

## 补充需求：成品归属（来源标记）+ 数据模型评估

**用户场景**：一条流水线（如「小红书种草笔记」）运行结束后产出**一整篇笔记**（组合内容：正文 markdown + 内联图片），需在 UI 与数据中**标记它来自哪条流水线**，并能按流水线浏览历史成品。

### 数据模型评估（已核实 artifacts / runs / graphs 三表）
- `artifacts` 表列（`db.ts:47`）：`id, run_id, node_id, attempt, kind, mime_type, label, size_bytes, storage, uri, created_at`。
- `runs` 表（`db.ts:22`）：`graph_id TEXT NOT NULL` → 经 `graphs.id/name` 解析流水线名。
- `artifact-store.ts:78 save()` 对 `content!=null` 的文本产物落盘（storage=local，uri=`/api/artifacts/:id`）。
- **生成媒体的双行引用契约（2026-09-01 狗粮补充）**：imageGen/videoGen/audioGen 产物的字节先由 worker 以独立行入库（id 形如 `up-…`，字节在 `uploads/` 桶），引擎 emit 的 run 行仅携带 `storage=local` + `uri=/api/artifacts/up-…` 引用（**自身桶下无字节**）。因此 `GET /api/artifacts/:id` 必须在本行 blob 缺失时跟随该本地引用取字节（`index.ts` 路由，回归用例 `api.artifact-localref.test.ts`：引用不继承所有权，跨用户仍 404）——否则历史 run 的生成图片全部显示为破图（dogfood tpl-product 实锤）。
- **整篇笔记其实已落库**：`run.ts:91-94` 对每一个 `artifact.produced` 事件（含 text）都调用 `artifacts.save()`，笔记以 `kind:"text"` 存进 artifacts 表；此前"未落库"的判断已纠正。仓库展示笔记时按需 `GET /api/artifacts/:id` 取内容即可。

| 需求 | 现有字段 | 够不够 | 说明 |
|---|---|---|---|
| 整篇笔记落库 | kind=text + content，`run.ts:91` 已全量保存 | ✅ 够 | 笔记已持久化；展示时取内容 |
| 标记来源流水线 | 仅 `run_id`（→runs.graph_id→graphs.name） | ⚠️ 间接够，非一等字段 | 经 join 可归因；但 artifacts 表无 `graph_id`，按流水线筛选需 join、无法建索引直查 |
| 按流水线浏览历史 | run_id + created_at（已索引） | ⚠️ 需 join | `listArtifactsForRun` 已有；缺"按 graph 直查" |
| 区分"成品"与"附件" | 无 role 字段 | ❌ 无 | 笔记与其内联图片同为 artifact；需识别哪一个是流水线主交付物 |
| 笔记按 markdown 渲染 | mime_type 默认 text/plain（`artifact-store.ts:13`） | ⚠️ 需补 | 引擎产 text 未设 mimeType，渲染器会当纯文本；应设 `text/markdown` |
| 标题 | label（text 产物当前为 null） | ⚠️ 可补 | 建议取笔记首行 H1 作 label，仓库卡片更可读 |

### 需要补的（并入 UI 重构）
1. **`artifacts` 表加 `graph_id`（NULL 允许）** + 索引 `idx_artifacts_graph(graph_id, created_at)`；`StoredArtifact`/`Artifact` 增加 `graphId`；落库时由 `run.ts`（已有 `graph.id`）注入；查询时 `LEFT JOIN graphs` 取 `graph_name`（沿用 `listRuns` 模式）。→ 解决"标记来自哪条流水线"+ 按流水线直查。
2. **（推荐）加 `role` 字段**（`source`/`intermediate`/`final`）或 `is_product`；引擎在产出 sink 文本时标 `final`，仓库据此把"整篇笔记"作为主交付物、其余作附件。
3. **（推荐）引擎产出笔记文本时设 `mimeType:"text/markdown"` 并填 `label`**（首行标题），使渲染器走 Markdown + 卡片可读。
4. UI：`ArtifactCard`/`FinishedProduct`/`ProductGallery` 显示"来自：<流水线名>"（用 graph_name）；新增"按流水线分组"的成品仓库视图。

> 不改动：核心 `Artifact` 7 种 kind 已足够表达笔记/图/视频/音频/文件/json/uri；`metadata` 列暂无必要（graph_id 已覆盖归属）。

---

## 实施进度

> 已落地（前端 2026-08-28 完成，Phase A-D 全部通过，含成本徽标与节点缩略图；全仓 `pnpm -r typecheck` 通过）。实施细节与验收记录见 [handoff.md](../handoff.md)，本文档不再重复维护。
