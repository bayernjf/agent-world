# 设计文档：产物归属 + 按流水线分组的成品仓库

> 状态：后端 schema 部分落地（`ab32074` 已提交 2026-08-28），引擎标注 + 前端进行中（工作树未提交）
> 关联文档：`docs/design-artifact-display.md`（产物统一渲染卡）
> 日期：2026-08-28

## 0. 背景与目标

当前流水线的产物（图片 / 视频 / 音频 / 文件 / 链接 / JSON / 文本）已经能在前端渲染（画廊、Inspector、成品面板三处），但存在两个体验断点：

1. **产物不知道"属于哪条流水线"**：`Artifact` / `StoredArtifact` 只有 `runId`，没有 `graphId` / `graphName`。用户在成品仓库里看到一堆产物，却无法区分是谁生产的、属于哪条流水线。
2. **note 类文本产物详情页空白**：文本产物由 `engine.ts` 的 `setTextArtifact` 生成，未带 `mimeType` / `label`，前端 `text` 分支走了原始 `<pre>`，Markdown 不渲染，首行 `# 标题` 也浪费了。
3. **没有"按流水线浏览"的视图**：成品仓库（`ProductGallery`）只支持按 kind 过滤，缺少按流水线聚合的分组视图。

本方案目标：给产物加上**流水线归属**与**角色（final/source/intermediate）**，并在前端复用已有 `ArtifactCard` 展示"来自：流水线名"，同时给画廊增加**按流水线分组**浏览模式。后端 schema 只增字段、不改结构，老数据完全兼容。

---

## 1. 现状核对（事实基线）

| 项 | 位置 | 现状 |
|---|---|---|
| `Artifact` 类型 | `packages/core/src/artifact.ts:19` | `id/kind/mimeType/content/uri/label/sizeBytes/metadata`，**无 graph 归属、无 role** |
| `StoredArtifact`（server） | `packages/server/src/artifact-store.ts:26` | 同上，落库 DTO |
| `StoredArtifact`（web） | `apps/web/src/lib/api.ts:151` | 与 server 镜像，前端复用类型 |
| 落库唯一入口 | `packages/server/src/run.ts:91` | `artifacts.save(artifact, { runId, nodeId, attempt })`，`graph.id` 在闭包内可用 |
| 文本产物生成 | `packages/server/src/engine.ts:180` `setTextArtifact` | 仅 `{ id, kind:"text", content }`，**无 mimeType / label / role** |
| sink 文本落库 | `packages/server/src/engine.ts:615-623` | 调 `setTextArtifact` 后 `produceArtifacts` |
| kind 渲染 | `apps/web/src/lib/artifact-renderers.tsx`、`Inspector.tsx:1104`、`ProductGallery.tsx:134` | 已支持 image/video/audio/uri；`json` 走 `<pre>`，`text` 走 `<pre>` |
| 画廊过滤 | `apps/web/src/components/ProductGallery.tsx:21` `FILTERS` | 仅按 kind（image/video/audio/file/uri/json/...） |
| 成品头部 | `apps/web/src/components/FinishedProduct.tsx` | 仅时间，无流水线名 |

**关键结论**：真问题不是"前端只认 image"——三处都能渲染多 kind；真问题是**缺统一归属信息 + 缺按流水线视图 + 文本产物未标注 mime/label**。

---

## 2. 后端改造（schema + 落库 + 引擎标注）

### 2.1 `db.ts` — artifacts 表加两列（均可空）

```sql
ALTER TABLE artifacts ADD COLUMN graph_id TEXT;   -- 归属流水线 id
ALTER TABLE artifacts ADD COLUMN role     TEXT;   -- 'source'|'intermediate'|'final'，NULL=未标注
CREATE INDEX IF NOT EXISTS idx_artifacts_graph ON artifacts(graph_id, created_at);
```

> SQLite 加可空列是安全的，老数据 `graph_id/role` 自动为 NULL，无需 migration 脚本。

- `ArtifactRow` 类型加 `graph_id: string | null`、`role: string | null`。
- `mapArtifact` 映射这两列。
- `insertArtifact` 的 `INSERT` 语句与参数同步。
- `listArtifacts` / `listArtifactsByRun` 的 `SELECT` 用 `LEFT JOIN graphs g ON a.graph_id = g.id` 顺带取 `g.name AS graph_name`，写入 `StoredArtifact`（前端免二次查名，与现有 `listRuns` 的 `LEFT JOIN graphs` 写法一致）。

### 2.2 `artifact-store.ts` — `StoredArtifact` 扩字段

```ts
graphId?: string | null;
graphName?: string | null;   // 来自 LEFT JOIN graphs，仅展示用
role?: "source" | "intermediate" | "final" | null;
```

`save(artifact, meta)` 的 `meta` 增加 `graphId?`、`role?`，落库时写回返回对象（与现有 `runId/nodeId/attempt` 同款处理）。

### 2.3 `run.ts:91` — 注入 graphId

```ts
db.insertArtifact(await artifacts.save(event.artifact, {
  runId,
  nodeId: event.nodeId,
  attempt: event.attempt,
  graphId: graph.id,   // 闭包内已有
}));
```

> `role` 由引擎在产物对象上标注（见 2.4），`run.ts` 透传 `meta.role` 即可。

### 2.4 `engine.ts` — 文本产物标注 + 角色标注

- 改造 `setTextArtifact`（`engine.ts:180`）：产出时补
  - `mimeType: "text/markdown"`
  - `label`：从正文首行 `# 标题` 提取（无则回退 `artifactLabel` 逻辑）
- sink 节点（`engine.ts:617`）：`setTextArtifact` 后将该 artifact 标 `role:"final"`。
- source 节点标 `role:"source"`；其余（agent/imageGen/gate 等）标 `role:"intermediate"`。判断点放在 `produceArtifacts`，按 `node.kind` 映射。

---

## 3. 前端改造（复用 ArtifactCard，零重写）

### 3.1 `artifact-renderers.tsx` — `ArtifactLike` 加归属字段 + 来源行

`ArtifactLike` 增加可选 `graphId?`、`graphName?`。卡外壳底部 `.artifact-meta` 区新增一行：

```
来自：<graphName>            // 无 graphName 时回退 "运行 #runId"
```

沿用现有 `.artifact-meta` 样式，不新造 CSS。

### 3.2 `FinishedProduct.tsx` — 头部显示归属

头部从"孤立时间"改为：`graphName · 运行 #runId · 时间`。文本 / Markdown 产物走已可复用的 `renderMarkdown`（现 `FinishedProduct.tsx:33` 内部定义，建议提升为共享）渲染，解决 note 详情空白。

### 3.3 `ProductGallery.tsx` — 按流水线分组浏览

在现有 `FILTERS`（按 kind）基础上，新增**分组维度切换**：`按类型` / `按流水线`。

- 「按流水线」模式：以 `graphName` 聚合，分组标题 `流水线名（产物数）`。
- 组内复用 `GalleryCard`（已含 image/video/audio/file/uri 渲染）。
- 每张卡显示来源 chip（来自 3.1）。
- 不新增路由，复用现有画廊页，最小侵入。

---

## 4. 分阶段实施 & 验收

| Phase | 内容 | 验收 |
|---|---|---|
| A 后端 schema | `db.ts` / `artifact-store.ts` / `run.ts` / `engine.ts` 四改 | `pnpm -F server typecheck` 通过；跑一条流水线，DB 中 `graph_id` / `role` 非空 |
| B 前端归属 | 3.1 / 3.2 | 卡片、成品头部出现"来自：XX流水线"；note 文本走 Markdown |
| C 画廊分组 | 3.3 | 画廊可切「按流水线」分组，来源 chip 正常 |
| D 回归 | 全量 typecheck + 老数据兜底 | 旧 NULL 归属 / role 不报错，三处展示面正常 |

---

## 5. 风险与权衡

- **老数据兼容**：两列可空，旧产物 `graph_id/role` 为 NULL，前端按"未归类 / 未归属"兜底，不报错。
- **类型同步**：`StoredArtifact` 在 server 与 web 两处镜像定义，本次改动需同步改 `api.ts:151`，避免前后端类型漂移。
- **改动面控制**：仅在 7 个文件内改动（db / artifact-store / run / engine / artifact-renderers / FinishedProduct / ProductGallery），不引入新表、新路由、新 CSS 类。
- **不破坏运行时**：只增字段，引擎既有逻辑（包重试、gate、connector）不受影响。

---

## 实施进度（2026-08-29）

- [x] **Phase A 后端 schema（部分）**：`db.ts` artifacts 加 `graph_id`/`role` 列 + `idx_artifacts_graph` 索引；`artifact-store.ts` / `run.ts` 注入 `graphId` 并落库。已随 `ab32074` 提交（2026-08-28）。
- [ ] **Phase A 引擎标注（未完）**：`engine.ts` 的 `setTextArtifact` 补 `mimeType: text/markdown` + 首行标题 `label`，以及 source/intermediate/final 角色标注 —— 工作树进行中，未提交。
- [ ] **Phase B 前端归属**：`artifact-renderers.tsx` 卡片来源行 / `FinishedProduct` 头部归属 —— 工作树进行中，未提交。
- [ ] **Phase C 画廊按流水线分组**：`ProductGallery` 分组切换 —— 工作树进行中，未提交。
- [ ] **Phase D 回归**：老数据 NULL 归属 / role 兜底。
