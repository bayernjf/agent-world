# TTS Provider 接入设计（audioGen 配音链路打通）

> 状态（2026-09-22 更新）：**P1 产品化 G-A / G-B / G-D（P1 检测）已写码落地**，四原子 commit `1ea3c62`（G-A core）/ `0a1ec39`（G-A server 计量）/ `93b3082`（G-B）/ `0cbf11e`（G-D），在 feature/20260824、**尚未 push**；core 323 / server 1295 测试全过、四包 typecheck 干净。**仍未做**：P0 真机端到端（待 SiliconFlow/OpenAI key，B4）、**G-C 软降级二选一（待产品决策）**、G-F 内置供应商骨架（待是否点名供应商的决策）、P2 分片拼接与 edge-tts。**2026-09-22 傍晚追加落地**：G-E 经复核前端（Inspector `audioModelOptions` 模态过滤 + ModelAssignModal audio 分组）与服务端派发闸门（`validate-models.ts` audioGen 错误模态=error）**早已就绪**，本次补齐 audioGen 三例服务端测试（`validate-models.test.ts` 12/12）；**G-H 配置 runbook 已落地** [runbooks/tts-provider-setup.md](runbooks/tts-provider-setup.md)（SF/OpenAI step-by-step + 验证清单 + 故障排查）。
> 目标：让 `tpl-news-podcast`（资讯播客工坊）等音频产线真正产出配音音频。
> 结论先行：**节点、Worker 接缝、OpenAI 兼容 provider 实现都已就绪（约 90%），缺口是「一个真正支持 `/audio/speech` 的供应商配置」+ 三处小口径（计费单位、音色命名、软降级一致性）**。推荐用硅基流动（SiliconFlow，原生 OpenAI 兼容、中文优、极低价）零代码先验证，再做少量产品化改动。

---

## 1. 背景与缺口

`tpl-news-podcast` 链路：话题(source) → 联网搜索(search) → 播客撰稿(textGen) → **AI 配音(audioGen)** → 成品(sink)。当前卡在 `AI 配音`：默认 agnes/apihub provider 只有 chat/image/video，**没有音频模型**，导致 audioGen 节点失败。

代码侧其实早已为 TTS 铺好路：

| 层 | 现状 | 位置 |
| --- | --- | --- |
| 节点 | `audioGenNode` 完整：取上游文本 → 调 `worker.generateAudio` → 存音频 artifact → 计量 | `packages/server/src/nodes/audiogen.ts`（71 行） |
| Worker 接缝 | `AudioGenArgs`/`AudioGenResult`、`Worker.generateAudio?`（可选，缺失软失败） | `packages/server/src/worker.ts:83-95,163` |
| Provider 实现 | `openAICompatibleWorker.generateAudio`：`POST {endpoint}/audio/speech`，body `{model,input,voice,response_format,speed}`，走 `guardedFetch`（SSRF 防护）、120s 超时、支持节点级 `baseUrl/apiKey` 覆盖、按输入字符计量 | `packages/server/src/providers/openai-compatible.ts:818-872` |
| 端点默认 | `MODALITY_ENDPOINT.audio = "/audio/speech"` | `packages/core/src/pricing.ts:22` |
| 节点配置 | `AudioGenConfig`：`model` 必填、`prompt?`、`voice?`、`format`(mp3/wav/opus/aac/flac，默认 mp3)、`speed`(0.25-4)、`n`(1-4)、`baseUrl?/apiKey?` | `packages/core/src/graph.ts:205-224` |
| Provider 配置 | 数据驱动 `ProviderConfig`：`baseUrl/apiKey/models/pricing/modalities/endpoints`，`source: builtin|custom`（custom 在「设置→供应商」可配） | `packages/server/src/config.ts:43-118` |
| 模板 | voice 节点写死 `model:"tts-1", voice:"alloy", format:"mp3"`，有 `ttsModel` field | `packages/core/src/templates.ts:1415-1482` |

**唯一硬缺口**：系统里没有配置任何一个 baseUrl 指向「真正实现 `/audio/speech`」的供应商 + key。默认 provider 收到 `/audio/speech` 会返回 404/不支持。

---

## 2. TTS 源调研对比（2026-09-22）

| 供应商 | 接口形态 | 模型 / 音色 | 价格（口径见下注） | 中文质量 | 商用合规 | 接入成本 |
| --- | --- | --- | --- | --- | --- | --- |
| **硅基流动 SiliconFlow**（推荐） | **原生 OpenAI 兼容** `POST /v1/audio/speech`，OpenAI SDK 直连 | `FunAudioLLM/CosyVoice2-0.5B`、`fishaudio/fish-speech-1.5`、`fnlp/MOSS-TTSD-v0.5`；系统预置 8 音色 `alex/benjamin/charles/david`（男）`anna/bella/claire/diana`（女），voice 须写成 `模型名:音色名`；支持声音克隆、情感控制、中英日韩+中文方言 | 按**输入 UTF-8 字节**，CosyVoice2 约 **$7.15 / 百万 UTF-8 字节**（注册送免费额度） | 优（CosyVoice 为阿里通义开源中文 TTS） | 正规云服务，可商用（看服务条款） | **零代码**（配 custom provider 即可） |
| **OpenAI 官方**（高质量付费备选） | 原生 `POST /v1/audio/speech` | `tts-1`、`tts-1-hd`、`gpt-4o-mini-tts`；音色 alloy/echo/fable/onyx/nova/shimmer 等；mp3/opus/aac/flac/wav/pcm | `gpt-4o-mini-tts` **$0.015 / 音频分钟**；`tts-1`/`tts-1-hd` 按字符计价（**本轮未从官方 pricing 页核实，落地前以 platform.openai.com/docs/pricing 为准**） | mini-tts 多语言可，tts-1 中文一般 | 官方可商用 | 零代码，但需官方 key + 国内网络代理 |
| **edge-tts（微软 Edge 大声朗读）** | **非 OpenAI**：WebSocket + SSML，需独立 adapter | 数百音色，中文 `zh-CN-XiaoxiaoNeural/YunxiNeural/XiaoyiNeural` 等 | **免费、无需 key** | 良（神经网络音色） | **灰色**：非官方逆向端点；微软 Learn 明确「依赖微软专有服务、无有效 Azure 订阅商用可能违反服务条款」，有频率限制/随时失效风险 | 需写 provider adapter（见 §6 P2） |
| 火山引擎 / 阿里云 CosyVoice 官方 / MiniMax | 多为自研 RPC/WebSocket/DashScope，非 OpenAI 形态 | 丰富、质量高 | 各家不同 | 优 | 官方可商用 | 需专门 adapter，本期不优先 |

> 价格来源（2026-09-22 检索）：SiliconFlow 官方用户指南/API 文档（端点、音色、格式、UTF-8 字节计费口径）与官方文章（$7.15/M UTF-8 bytes）；OpenAI `gpt-4o-mini-tts` $0.015/min 见 2025-03 智东西、齐鲁壹点对 OpenAI 发布的报道；edge-tts 商用条款见 Microsoft Learn 问答，Node 移植见 npm `msedge-tts`（MIT，2026-07 仍更新）、`@echristian/edge-tts`。
> 信心：代码事实 10/10（一手读码）；SiliconFlow 接口 9/10（官方文档）；OpenAI 字符单价 6/10（本轮未打开官方 pricing 页，落地前须复核）；edge-tts 合规 8/10（官方问答 + npm）。

---

## 3. 推荐方案：三档推进

### P0 — 零代码先验证（今天可做，约 10 分钟）

用 SiliconFlow 跑通端到端，验证现有实现是否真的开箱即用：

1. 注册 SiliconFlow 拿 API key（`https://cloud.siliconflow.cn/account/ak`，国内站）。
2. 「设置 → 供应商」新建 custom provider：
   - baseUrl：`https://api.siliconflow.cn/v1`
   - apiKey：SF key
   - models：`FunAudioLLM/CosyVoice2-0.5B`
   - modalities：`{ "FunAudioLLM/CosyVoice2-0.5B": "audio" }`
   - pricing：先留空（免费额度期，成本显示 0；正式用再按 §4-G-A 配）
3. 打开 `tpl-news-podcast` 的 voice 节点：
   - model = `FunAudioLLM/CosyVoice2-0.5B`
   - voice = `FunAudioLLM/CosyVoice2-0.5B:alex`（**注意不是 alloy**，见 §4-G-B）
   - format = `mp3`
4. 运行，确认产出音频 artifact 并能播放。

> 这一步不改一行代码，用于确认 `generateAudio` 的请求体/返回二进制处理与 SF 完全兼容。若有差异（如 SF 要求额外 header），记录后在 P1 修。

### P1 — 产品化小改（推荐正式落地，工作量小）

见 §4 改动清单与 §5 提交计划。核心：补齐**字节计费口径**、**模板音色参数化**、**无 TTS 能力时的软降级一致性**，让任意用户配好 key 即可稳定出音频，成本准确归集。

### P2 — 可选免费源（edge-tts，仅开发/狗粮）

新增一个独立 `edgeTtsProvider` 实现 `generateAudio`（WebSocket+SSML），无需 key，适合本地开发与狗粮演示；**明确标注非官方、不保证可用、不建议商业化依赖**。不阻塞 P1。

---

## 4. 工程缺口与改动清单

### G-A　计费口径：字符 vs UTF-8 字节（需改 core，小）　✅ 已落地（2026-09-22，`1ea3c62` core + `0a1ec39` server）

- 现状：`generateAudio` 用 `mediaUsage({ characters: input.length }, …)`，`ModelPricing` 音频只支持 `perSecond` / `perKiloChar`（USD/1K **字符**）。
- 问题：SiliconFlow 按 **UTF-8 字节**计费，中文 1 个汉字 ≈ 3 字节，直接用字符数会**低估约 3 倍**。
- 改法（向后兼容，纯增量）：
  1. `packages/core/src/pricing.ts`：`Usage.units` 增 `utf8Bytes?`；`ModelPricing` 增 `perMegaUtf8Byte?`（USD/百万 UTF-8 字节，与 SF 口径对齐）；`computeCost` 增该字段分支；`PRICING_FIELDS.audio` / 标签 / i18n 增一项。
  2. `openai-compatible.ts generateAudio`：按 input 文本计算 `Buffer.byteLength(input || config.prompt || "", "utf8")`，与现有 `characters` 一起上报（OpenAI 系用 perKiloChar/perSecond，SF 用 perMegaUtf8Byte，各取所需，互不冲突）。
  3. SF custom provider 的 pricing 配 `{ "FunAudioLLM/CosyVoice2-0.5B": { perMegaUtf8Byte: 0.00715 } }`（$7.15/M，落地前以官方现价复核）。
  4. 补 core pricing 单测 + provider 计量单测。

### G-B　音色命名不兼容（模板/配置）　✅ 已落地（2026-09-22，`93b3082`：新增 `ttsVoice` field，默认保留 OpenAI 通用 `alloy`，placeholder 写明 SF 须改 `模型名:音色名`）

- OpenAI 用具名音色 `alloy`；SiliconFlow 要求 `模型名:音色名`（如 `FunAudioLLM/CosyVoice2-0.5B:alex`），克隆音色是 `speech:名称:id`。模板写死的 `voice:"alloy"` 在 SF 上会报错。
- 改法（推荐，轻量）：给 `tpl-news-podcast` 增加 `ttsVoice` field（`applyTo: [{nodeId:"voice", path:"audioGen.voice"}]`），placeholder 说明两套命名；默认值按目标供应商给（若 P0 验证以 SF 为主，默认改 SF 预置音色；若要保持 OpenAI 通用则保留 alloy 并在描述里写明 SF 需改）。
- 不做 provider 层「音色别名映射」（alloy→某 SF 音色）——音色是供应商特定资产，硬映射会误导，参数化 + 文档更诚实。

### G-C　「软跳过」注释与实际失败行为不一致（需产品决策）　⏸ 未做（2026-09-22：本轮不改变失败语义，维持 `failed` + VALIDATION，模板「软跳过」注释暂保留；须产品在两选项间拍板后再动）

- `tpl-news-podcast` 模板注释声称「默认供应商不支持 TTS 时该节点会**软跳过**，稿件文本仍完整产出」；但 `audiogen.ts:14-20` 在 `worker.generateAudio` 缺失时实际是 `states=failed + node.failed(VALIDATION)`——**会让节点失败**（无 error 边时整条 run 失败），与注释矛盾。
- 两个选项：
  - **（推荐）改成真软降级**：无 `generateAudio` 能力时，节点置 `skipped` + 发一条 warning 事件/日志，上游稿件文本仍流到 sink 交付。理由：播客场景里「稿件」是主产物、「配音」是增值，没配音频 key 不应让整条产线废掉；这也让模板在零配置下可跑出文本结果。
  - 或维持 failed（音频是该模板的明确卖点，缺能力就该显眼报错），**改注释**去掉「软跳过」表述。
- 倾向推荐前者，但这改变失败语义，需与产品意图确认后二选一；无论选哪个都要消除「注释说一套、代码做一套」。

### G-D　长文本分片（P1 检测，拼接列 P2）　✅ P1 检测已落地（2026-09-22，`0cbf11e`：导出 `TTS_MAX_INPUT_CHARS=4096`，合成前超长 fail-fast `failed`+VALIDATION、不发请求、不静默截断；P2 分片拼接仍缓做）

- 现状：`generateAudio` 把整段 input 一次性 POST，无分片。OpenAI 单次输入有长度上限（历史为 4096 字符，**以官方文档为准**）；SF CosyVoice2 单次长度也有上限（官方用户指南未给明确数字，P0 验证时实测）。
- 2 分钟中文口播稿约 400-500 字，通常不超限；但更长的播客/有声书会。
- P1 做法（小而稳）：合成前检测长度，超阈值给出**明确报错**（提示拆分节点/缩短稿件），不静默截断。
- P2 做法（较大，慎入）：按句/段边界切分逐段合成，再拼接。注意 **mp3 不能直接二进制 concat**（有帧头/间隙），应请求 `wav`/`pcm` 在服务端做 PCM 拼接（或引入 ffmpeg/音频处理依赖，与当前「零原生依赖」取向冲突，需单独评估）；第一版也可选择产出多段音频 artifact（但现有 `n` 语义是「生成 N 个变体」而非「N 个分片」，不宜复用）。

### G-E　Provider 路由 / 模态校验

- 选 TTS 模型时必须路由到音频供应商，不能落到 agnes。现有 `modalityOf(provider,model)` 读 `provider.modalities[model]`，`validate-models.ts` 已有模态校验——P0 在 custom provider 里正确填 `modalities` 即可；P1 确认 audioGen 选模型/供应商的 UI 只列出声明了 audio 模态的供应商，避免用户选到纯文本 provider 后得到 404。

### G-F　不硬编码任何第三方付费 key

- SF/OpenAI 的 key 都是用户自己的，不写进 builtin 默认配置、不进仓库。形态为 **custom provider + 一份开箱配置 runbook**（P1 文档化）。可选：加一个不带 key 的 builtin「SiliconFlow TTS」骨架（baseUrl/models/modalities/pricing 预置，引导用户只填 key），降低配置成本——是否内置骨架取决于是否想在产品里点名该供应商。

### G-H　i18n / 测试 / 文档

- G-A/G-C 新增的用户可见文案（计价字段名、软降级提示、音色 field 描述、超长报错）走 zh/en i18n + 设计 token。
- 测试：扩展 `engine.audiogen.test.ts`（字节计量、无能力软降级/失败二选一后的行为、空结果 UNSUPPORTED、n 段）、`pricing.test.ts`（perMegaUtf8Byte）、`openai-compatible.test.ts`（generateAudio 请求体/二进制/计量，mock fetch）。
- 文档：本设计 + `docs/README.md` 索引 + 一份「TTS 供应商配置」runbook（SF 与 OpenAI 两套 step-by-step）+ handoff。

---

## 5. 原子提交计划（英文 message、不 push）

> **落地状态（2026-09-22）**：步骤 2 ✅ `1ea3c62`；步骤 3 被拆分——G-A server 计量 ✅ `0a1ec39`，**G-C 软降级未做（待产品决策，故该 commit 不含 soft-degrade）**；步骤 4 ✅ `93b3082`（仅 G-B field，未改注释，因 G-C 未定）；步骤 5 ✅ `0cbf11e`；步骤 1（P0 真机，卡 key）、步骤 7（edge-tts，P2）未做；**步骤 6（runbook）已落地** [runbooks/tts-provider-setup.md](runbooks/tts-provider-setup.md)（2026-09-22）。四个 commit 均在 feature/20260824，未 push。

1. **P0 验证不产生代码**；验证结论（兼容/差异）回写本文。
2. `feat(core): price audio by UTF-8 bytes for TTS providers`（G-A：units/pricing/computeCost/字段/i18n + 单测）。
3. `fix(server): meter TTS by input UTF-8 bytes and (decided) soft-degrade when audio unsupported`（G-A server 侧 + G-C 选定行为 + 单测）。
4. `feat(core): parameterize podcast template TTS voice and document provider values`（G-B 模板 field + 注释订正）。
5. `feat(server): explicit over-length error for TTS input`（G-D 检测，拼接留 P2 issue）。
6. `docs: TTS provider runbook and index`（runbook + README 索引 + handoff + 本设计状态更新）。
7. （P2，独立）`feat(server): optional edge-tts provider for local/dogfood use`，文档显著标注非官方/商用风险。

> 步骤 2-5 中，仅步骤 3 触及节点失败语义（G-C），其余为纯增量；不碰 run 调度核心，不影响 M1 回采。

---

## 6. edge-tts 免费源（P2）技术草案

- Node 生态可选库：`msedge-tts`（MIT，SSML，2026-07 仍维护）、`@echristian/edge-tts`（`synthesize/synthesizeStream/getVoices`）、`@travisvn/edge-tts`、`edge-tts-universal`（isomorphic-ws，Node+浏览器）。落地前需实测其在 Node 24、公司网络下的可用性与依赖体积。
- 形态：新增 `edgeTtsProvider`（不是 OpenAI 兼容 worker），实现 `generateAudio`：把 input 转 SSML（`<speak><voice name="zh-CN-XiaoxiaoNeural"><prosody rate=…>`）→ WebSocket 取音频流 → 拼 Buffer → 返回 `AudioGenResult`（mp3，usage 计 0 成本，units 可记 `characters`）。
- voice 名是 `zh-CN-XiaoxiaoNeural` 这类，与 OpenAI/SF 都不同，靠节点 `voice` 字段直传。
- **必须在 UI/文档显著标注**：非官方端点、可能限流或随时失效、商用需自行评估微软服务条款。默认不启用、不内置进任何产线模板，仅作为「本地免费试听」选项。

---

## 7. 明确不做

- ❌ 不在仓库内置任何第三方付费 API key，不承诺第三方价格（价格以供应商官方页实时为准）。
- ❌ 本期不接火山/阿里/MiniMax 等自研协议 TTS（需各自 adapter，等有真实需求）。
- ❌ 不做音频后期（混音、BGM、降噪、多角色对位剪辑）——超出「配音」节点范围。
- ❌ 不把 edge-tts 作为商业化 SLA 承诺的能力。
- ❌ P1 不做 mp3 服务端拼接（依赖重、风险高，长文本先明确报错）。

---

## 8. 参考来源

- SiliconFlow 文本转语音用户指南：https://docs.siliconflow.com/cn/userguide/capabilities/text-to-speech
- SiliconFlow Create speech API：https://docs.siliconflow.com/en/api-reference/audio/create-speech
- SiliconFlow TTS 定价（$7.15/M UTF-8 bytes）：https://www.siliconflow.com/articles/best-lightweight-tts-models-for-chatbots
- OpenAI gpt-4o-mini-tts $0.015/min 报道：智东西 https://m.toutiao.com/group/7484149473351664167/ ；齐鲁壹点 https://m.toutiao.com/group/7484170974134321704/
- edge-tts 商用条款（Microsoft Learn）：https://learn.microsoft.com/en-gb/answers/questions/2088770/
- msedge-tts（npm）：https://www.npmjs.com/package/msedge-tts
