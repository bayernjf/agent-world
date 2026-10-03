# 视频生成质量修复方案（agnes-video-2.5-flash 方言对齐 + 首帧/参考图）

> 状态：**方案**（2026-10-03，feature/20260824）｜实施：待批准
> 问题入口：用户反馈「视频生成质量特别差」，且短视频产线存在间歇 failed/degraded

---

## 一、背景与现象

短视频产线（media pipeline）产出的成片质量差、构图失控，且产线存在间歇性 failed（此前归因于瞬时网络/AUTH）。排查发现：**根因不在模型档位或免费 tier，而在请求方言与 agnes 官方 API 严重不符**——视频生成从未按正确参数调用过。

## 二、证据：代码 vs agnes 官方文档（2026-09-29 版）

官方文档：`https://wiki.agnes-ai.com/en/docs/agnes-video-25-flash.md`（Create Task `POST /v1/videos`，Retrieve `GET /agnesapi?video_id=..&model_name=..`）

| 维度 | 当前代码（`packages/server/src/config.ts`） | agnes 2.5-flash 官方参数 | 后果 |
|---|---|---|---|
| **mode** | 写死 `createBody: { mode: "ti2vid" }`（:331） | 仅 `text` / `keyframe` / `reference` 三值 | `ti2vid` 非法：图生视频/首帧能力从未启用，服务端若容忍则静默 fallback 纯文生视频；若拒绝则 400 |
| **尺寸** | 发 `width`/`height`（16:9→1280×720，:333-338） | flash 固定 `size:"720P"`（字符串）+ `aspect_ratio`；参数表**无 width/height** | width/height 被忽略，画幅控制失效（永远默认 16:9） |
| **轮询路径** | `GET /v1/videos/:id`（openai-compatible.ts:770） | `GET /agnesapi?video_id=..&model_name=agnes-video-2.5-flash`（keyframe/reference 必带 model_name） | 路径不符 → 轮询 404/无效响应 → 5 分钟窗口耗尽 → `degraded`/超时（G4 链路把失败转成 halt 等待，掩盖了根因） |
| **时长** | `omitDuration: true`，不发送任何时长参数（:332） | `seconds` 字符串 "4"–"12"（默认 "5"） | 时长永远服务端默认 5s，模板 `duration: 5` 配置被丢弃 |
| **n** | `min(4, max(1, trunc(n))`（openai-compatible.ts:709） | 仅 `1` | 传 n>1 会 400；当前模板 n=1 无实际影响，但类型上允许越界 |

另有三个已确认的适配点（代码与文档一致，保留）：
- 端点 `POST /v1/videos`（config.ts:327 `endpoints.video: "/videos"`）✓
- 完成态取顶层 `url`（config.ts:339 `resultUrlPath: "url"`）✓
- 时长从 `seconds` 字段读（config.ts:341 `durationPath: "seconds"`）✓ —— 注意文档返回 `"seconds": "4"` 是字符串，现代码已做字符串 coerce（注释记录 verified live 2026-09-09）

## 三、目标

1. **阶段 1（修方言，必做）**：按官方参数重写 videoAdapter——`mode` 合法化、`size:"720P"`+`aspect_ratio`、`seconds` 可传、检索路径可模板化。让现有纯文本链路按正确方言跑通，消除「质量差 + 间歇失败」。
2. **阶段 2（喂首帧/参考图，提质量）**：videoGen 节点支持读上游图（keyframe 的 `first_frame` / reference 的 `images`），media pipeline 模板加 imageGen 首帧节点 → 真正图生视频，构图/主体可控。

## 四、改动设计

### 4.1 core：VideoGenConfig 扩展（阶段 2）

`packages/core/src/` 中 VideoGenConfig 增加：
- `mode?: "text" | "keyframe" | "reference"`（默认 `"text"`，兼容现有产线零改动）
- `imageSource?: "upstream"`（取上游首个 image 类产物；仅 keyframe/reference 有效）

GraphNode 连线天然支持上游产物流入（与 textgen 取上游文本同机制），videoGen 节点执行时若 `imageSource` 命中，从上游 artifact 中取第一张图（已落库的 `storeBinary` URI 或 dataUrl）。

### 4.2 server：videoAdapter 方言重写（阶段 1 主体）

`config.ts` 的 agnes `videoAdapter` 改为：

```ts
videoAdapter: {
  // mode 由节点配置（text/keyframe/reference），不再写死 ti2vid
  createBody: { size: "720P" },          // flash 固定档
  omitDuration: false,                   // 允许传 seconds（字符串，由 config.duration 映射）
  aspectAsRatio: true,                   // aspect → aspect_ratio 字符串（16:9 等），不再发 width/height
  aspectToSize: undefined,               // 移除旧 width/height 映射
  firstFramePath: "first_frame",         // keyframe 模式首帧图字段（URL）
  imagesPath: "images",                  // reference 模式参考图数组字段（URL）
  resultUrlPath: "url",
  durationPath: "seconds",
  // 检索 URL 模板化（agnes 特例：/agnesapi?video_id=..&model_name=..）
  retrievalUrlTemplate: "/agnesapi?video_id={jobId}&model_name={model}",
}
```

对应 provider（`openai-compatible.ts`）：
- body 构造：`size` + `aspect_ratio` 走 adapter 新字段；`seconds` 由 `config.duration` 映射为字符串（"4"–"12" clamp）；mode 取 `config.mode ?? "text"`；keyframe 时注入 `first_frame`（阶段 2 的图 URL），reference 时注入 `images: [..]`（≤5）
- 轮询 URL：`adapter.retrievalUrlTemplate` 存在时，用模板替换 `{jobId}`/`{model}` 生成查询 URL（含 query string），否则沿用 `GET <endpoint>/:id` 兼容其他 provider
- `n` clamp 上限改 1（agnes 只支持 1），保留通用性：仅当 adapter 声明 `maxN` 时按其 clamp

### 4.3 模板：media pipeline 加首帧节点（阶段 2）

`packages/core/src/templates.ts` 的 mediaPipelineGraph：
- scriptwriter 之后插一个 `imageGen` 节点（keyframe 首帧：脚本主体 + 画面提示词 → 首帧图），model 空（跟默认 image 模型）
- video 节点改 `videoGen.mode: "keyframe"` + `imageSource: "upstream"`（读首帧图）+ prompt 仍用上游脚本（描述运动），画幅 `9:16`（竖屏短视频默认，待定）

### 4.4 测试

- server：`builtin-catalog.test.ts` / `api.model-catalog.test.ts` 断言 adapter 新字段；新增 videoAdapter body 构造单测（text/keyframe/reference 三种 body 形状 + seconds clamp + n clamp）
- provider：轮询 URL 模板单测（agnes 特例路径 + 通用 `:id` 兼容路径）
- core：VideoGenConfig 类型/默认值测试；media pipeline 模板结构测试（新节点连线、mode/imageSource 断言）
- 全量：`pnpm -r typecheck` + server/web 全量测试

### 4.5 真机验证（实施后）

Hasee 部署后，跑一条短视频产线（或手工提交一条 keyframe 视频）：
- 对比修复前后：任务 done 率（预期 failed/degraded 归零或大幅下降）、成片构图/主体可控性
- 确认 9:16 竖版输出实际尺寸（文档实测 720P 16:9 产出 1280×704）

**验证状态（2026-10-03）**：Hasee 已部署 `fc879bb`（= PR #480 merge，含阶段 1 `c9662bf` + 阶段 2 `7f380db`，`git merge-base --is-ancestor` 双确认）；`AGNES_API_KEY` 已于 10-02 19:58 经 systemd drop-in `agent-world.service.d/agnes.conf`（600）注入、23:51 重启生效——10-02 15:00 短视频 run failed "Missing API key" 系 key 注入前的旧基线，非代码回归；部署后文本产线两条 run done 无回归。**部署后第一条视频 run 待触发**：M1 短视频产线（`trg_m1_video_daily`，cron `0 3,15 * * *`）10-03 15:00 UTC（北京时间 23:00）自动首跑；其 videoGen 节点无 `mode` 字段 → 默认 text 模式，无需 publicUrl；部署前基线 7 条 = 6 done + 1 failed（key 未注入）。触发后由定时任务自动拉取 run 状态对比基线、检查成片 artifact，观察期 3 天（done 率趋势），结果登记 handoff #86。

## 五、风险与取舍

| 风险 | 影响 | 对策 |
|---|---|---|
| agnes API 方言可能继续变（`ti2vid` 或为旧版遗留） | 修复后仍可能再错 | adapter 全部参数集中一处，升级只改 config.ts；真机验证兜底 |
| keyframe 需要图片 URL 公网可达（文档要求） | 图生视频失败 | 产线内图已走 `storeBinary` 落库，需确认对外可达 URL（或转 dataUrl/base64 实测）；不可达则降级 reference 或 text |
| 检索 URL 模板化影响其他 provider | 回归 | 仅 adapter 声明模板时启用，默认路径不变；既有 provider 测试全量回归 |
| `seconds` 传 "12" 上限 | 成本/时长超预期 | clamp 4–12，模板保持 5 |

## 六、实施顺序（建议原子提交）

1. `fix(server): align agnes video adapter with official 2.5-flash API` —— 阶段 1 方言 + provider 模板化 + 单测
2. `feat(core): videoGen mode/imageSource config + media pipeline first-frame node` —— 阶段 2 + 模板 + 测试
3. `docs: record video quality fix design and closure` —— handoff/README/CHANGELOG 登记

阶段 1 与阶段 2 可拆开：先推阶段 1（纯修复，风险低、立刻止血），阶段 2 视验证结果跟进。
