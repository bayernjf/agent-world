# TTS 供应商配置 Runbook（audioGen 配音链路）

> 适用：agent-world server（`packages/server`）+ web「设置 → 模型」。
> 对应设计：[../design-tts-provider.md](../design-tts-provider.md)；实现：`packages/server/src/providers/openai-compatible.ts`（`generateAudio`，`POST {baseUrl}/audio/speech`）、`packages/server/src/validate-models.ts`（audio 模态派发闸门）、`packages/core/src/pricing.ts`（`perMegaUtf8Byte` 字节计费）。
> 落地状态（2026-09-22）：**P1 产品化已落地并部署 Hasee `c90c8d9`**（G-A 字节计费 `1ea3c62`/`0a1ec39`、G-B 模板音色参数化 `93b3082`、G-D 超长 fail-fast `0cbf11e`）；**P0 真机端到端待一个真实 TTS key**（本文档两套配置任选其一）。
> 结论先行：节点、Worker、UI 模态过滤、派发闸门、计量口径全部就绪，**唯一硬缺口是「配置一个真正实现 `/audio/speech` 的供应商 + key」**。推荐 SiliconFlow（原生 OpenAI 兼容、中文优、极低价、注册送额度），零代码约 10 分钟跑通。

---

## 1. 链路与前置约束

- `tpl-news-podcast` 链路：话题(source) → 联网搜索(search) → 播客撰稿(textGen) → **AI 配音(audioGen)** → 成品(sink)。
- audioGen 只路由到**声明了 `audio` 模态**的供应商模型；默认 agnes/apihub 只有 chat/image/video，**没有音频模型**，直接选会在派发前被拦截（见 §5）。
- 接口契约（OpenAI 兼容）：`POST {baseUrl}/audio/speech`，请求体 `{ model, input, voice, response_format, speed }`，返回音频二进制；走 SSRF 防护 `guardedFetch`、120s 超时。
- 输入上限：`TTS_MAX_INPUT_CHARS = 4096` 字符，合成前超长直接 fail-fast（`failed` + VALIDATION，不发请求、不静默截断）。长文本分片拼接列 P2 未做，超限请拆分稿件。
- key 安全：供应商 key 属于部署方/用户自己，**不写进内置默认配置、不进仓库**；经「设置」保存后加密落库；节点级「自定义端点」也支持单独覆盖 baseUrl/apiKey。

## 2. 方案 A：SiliconFlow（推荐，国内直连）

### 2.1 拿 key

1. 注册并登录 `https://cloud.siliconflow.cn/`。
2. 「账户 → API 密钥」(`https://cloud.siliconflow.cn/account/ak`) 新建密钥，复制 `sk-...`（新账户送免费额度，够验证）。

### 2.2 在产品里新建 custom provider

「设置（Settings）→ 模型（Models）→ 供应商」新建自定义供应商，填：

| 字段 | 值 |
|---|---|
| baseUrl | `https://api.siliconflow.cn/v1` |
| apiKey | 上一步的 SF 密钥 |
| models | `FunAudioLLM/CosyVoice2-0.5B`（也可加 `fishaudio/fish-speech-1.5`） |
| modalities | `{ "FunAudioLLM/CosyVoice2-0.5B": "audio" }`（**必须声明 audio，否则模型下拉里看不到**） |
| pricing（可选） | `{ "FunAudioLLM/CosyVoice2-0.5B": { "perMegaUtf8Byte": 0.00715 } }` |

> pricing 口径：SF 按**输入 UTF-8 字节**计费，CosyVoice2 约 **$7.15 / 百万 UTF-8 字节**（中文 1 字 ≈ 3 字节；免费额度期可先留空，成本显示 0，正式使用前以 SF 官方现价复核再填）。

保存后用该行的「测试连接」验证（探测按模型模态走 `/audio/speech`）。

### 2.3 配置播客模板的 voice 节点

打开 `tpl-news-podcast`（实例化后的图），选中 AI 配音节点：

- model = `FunAudioLLM/CosyVoice2-0.5B`
- voice = `FunAudioLLM/CosyVoice2-0.5B:alex`（**SF 音色必须写成「模型名:音色名」，不是 `alloy`**；预置音色：男 `alex/benjamin/charles/david`，女 `anna/bella/claire/diana`）
- format = `mp3`

> G-B 已给模板加 `ttsVoice` 参数字段（默认保留 OpenAI 通用 `alloy`）；用 SF 时在模板参数表单直接填 `模型名:音色名` 即可，无需进节点手改。

### 2.4 跑通验证

运行产线，确认：① voice 节点 `done`；② 产出音频 artifact 并可在前端播放/下载；③ 成本报表按 UTF-8 字节计费、金额合理（非 0 即 pricing 生效）。

## 3. 方案 B：OpenAI 官方（高质量付费备选）

前提：可直连 OpenAI 的网络（国内需代理），官方 key。

「设置 → 模型 → 供应商」新建：

| 字段 | 值 |
|---|---|
| baseUrl | `https://api.openai.com/v1` |
| apiKey | OpenAI 平台密钥 |
| models | `tts-1`（或 `gpt-4o-mini-tts` / `tts-1-hd`） |
| modalities | `{ "tts-1": "audio" }` |
| pricing | `tts-1`/`tts-1-hd` 按字符填 `perKiloChar`；`gpt-4o-mini-tts` 按音频分钟填 `perSecond`（**落地前以 `https://platform.openai.com/docs/pricing` 官方现价为准换算**，本 runbook 不固化未核实数字） |

voice 节点：model = `tts-1`，voice = `alloy`（可选 `echo/fable/onyx/nova/shimmer`；`gpt-4o-mini-tts` 还支持自然语言音色指令），format 可选 `mp3/opus/aac/flac/wav/pcm`。

## 4. 验证清单

- [ ] custom provider 保存后「测试连接」通过；
- [ ] audioGen 节点模型下拉**只出现**声明 audio 模态的模型（text/image/video 模型不出现在列表）；
- [ ] voice 节点 `done` 且产出可播放音频；
- [ ] 成本报表有该节点成本（SF 看 UTF-8 字节口径，OpenAI 看字符/秒口径）；
- [ ] 输入 > 4096 字符时得到明确的 VALIDATION 报错（提示拆分稿件），且**没有发出请求**（不产生费用）。

## 5. 故障排查

| 现象 | 根因 / 处理 |
|---|---|
| 模型下拉里看不到 TTS 模型 | provider 的 `modalities` 没把该模型声明为 `audio`，或 provider 被停用；回 §2.2 检查 |
| 派发即被拦：「实际是 文本 类型，无法产出音频」 | `validate-models.ts` 硬闸门：选中的模型未声明 audio 模态。改选 audio 模型（前端下拉本应过滤，常见于直接调 API 或旧图） |
| 404 / 不支持该路径 | 该供应商没实现 `/audio/speech`（如 agnes）；换 SF/OpenAI，或用 provider `endpoints.audio` 覆盖到真实路径 |
| 音色无效 / 400 voice not found | SF 用了 `alloy` 这类 OpenAI 具名音色；SF 必须 `模型名:音色名`（§2.3） |
| `failed` + VALIDATION「输入过长」 | 超过 `TTS_MAX_INPUT_CHARS=4096`；拆短口播稿（分片拼接为 P2，未实现） |
| 无 TTS 能力时整条 run 失败 | 当前行为 = `failed` + VALIDATION（**G-C 软降级尚未决策**：另一选项是软跳过 voice 节点、稿件文本仍产出；拍板后改） |
| 成本显示 0 | provider pricing 留空（免费额度期正常）；正式使用按 §2.2 填 `perMegaUtf8Byte`/`perKiloChar`/`perSecond` |

## 6. 不做 / 缓做

- **edge-tts（微软 Edge 大声朗读）**：免费无 key 但属非官方逆向端点，商用有服务条款风险、可能随时失效，仅适合本地开发/狗粮，列 P2，需独立 WebSocket+SSML adapter，不得作为商业化依赖。
- **内置供应商骨架**：是否在产品里预置一个不带 key 的「SiliconFlow TTS」骨架（baseUrl/models/modalities/pricing 预置、只引导填 key）取决于是否愿意在产品中点名该供应商（G-F，待定）。
- **长文本分片拼接**：P2。
