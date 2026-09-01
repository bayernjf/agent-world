# Example Pipelines

A collection of ready-to-use graph templates. Each can be imported via the
board's **新建产线** dialog, or used as a starting point for your own.

> **单一事实源**：可直接实例化的内置模板定义在 `packages/core/src/templates.ts`（`TEMPLATES` 导出），
> 下表是文档导览；未标注模板 id 的条目是设计示例，需手工搭建。

| 内置模板 id | 名称 | 类别 |
|---|---|---|
| `tpl-product` | 淘宝商品详情 | 营销内容 |
| `tpl-xiaohongshu` | 小红书种草笔记 | 营销内容 |
| `tpl-media-pipeline` | 短视频广告工坊 | 营销内容 |
| `tpl-draft` | 写草稿 | 写作 |
| `tpl-translation` | 翻译流水线 | 写作 |
| `tpl-doc-review` | 文档审查 | 写作 |
| `tpl-ops-weekly` | 运营周报 | 数据分析 |
| `tpl-competitor-watch` | 竞品监控摘要 | 数据分析 |
| `tpl-data-report` | 数据报表生成 | 数据分析 |
| `tpl-patrol-alert` | 定时巡检告警 | IT 运维 |
| `tpl-research-brief` | 多源研究简报 | 研究 |
| `tpl-research-loop` | 多课题深度调研 | 研究 |
| `tpl-news-podcast` | 资讯播客工坊 | 研究 |
| `tpl-batch-content` | 批量内容工坊 | 内容生产 |
| `tpl-doc-ingest` | 文档智能解析入库 | 文档处理 |
| `tpl-scan-ocr` | 扫描件数字化 | 文档处理 |
| `tpl-review-publish` | 人工审核发布 | 工作流 |
| `tpl-custom-model` | 自定义模型接入 | 工作流 |
| `tpl-release-pr` | 发版 PR 助手 | 工作流 |
| `tpl-customer-service` | 客服工单自动处理 | 客户服务 |
| `tpl-code-review` | 代码审查助手 | 开发 |
| `tpl-contract-review` | 合同审查助手 | 法律合规 |
| `tpl-course-outline` | 课程大纲生成 | 教育 |
| `tpl-travel-plan` | 旅游行程规划 | 生活 |
| `tpl-recipe` | 菜谱生成 | 生活 |
| `tpl-blank` | 空白产线（创建入口，非业务模板） | 基础 |

---

## 1. Content Rewrite Loop (Draft → Critic → Rewrite → Output)

The classic quality loop. A writer drafts, a critic checks against a standard,
and on failure the draft goes back to the writer with the critic's feedback.

**Nodes:**
- `source` — input brief / topic
- `textGen` (writer) — writes a first draft
- `gate` (critic) — checks against `criterion`; on fail, sends a `rework` edge back to writer
- `sink` — final output

**Edges:**
- `source → writer` (flow)
- `writer → critic` (flow)
- `critic → sink` (flow, on pass)
- `critic → writer` (rework, on fail)

**Gate config:**
```json
{ "maxAttempts": 3, "criterion": "The draft must include a hook, three body points, and a call to action.", "onExhausted": "pass" }
```

**Use when:** you need iterative quality improvement on text — blog posts,
ad copy, technical docs, email sequences.

---

## 2. Product Listing Generator (Source → Image → Copy → Output)

Generate a complete e-commerce product listing from a brief: product photo
(AI-generated if none provided), marketing copy, and structured output.

**Nodes:**
- `source` — product brief (name, brand, audience, price range, tone)
- `imageGen` — generates a product scene image
- `textGen` (copywriter) — writes title, description, bullet points
- `sink` — final listing

**Edges:**
- `source → imageGen` (flow)
- `source → copywriter` (flow)
- `imageGen → copywriter` (flow) — the image flows as a reference
- `copywriter → sink` (flow)

**ImageGen config:**
```json
{ "model": "agnes-image", "prompt": "", "aspect": "3:4", "n": 1 }
```
Leave `prompt` empty to auto-generate from the source brief.

**Use when:** e-commerce content generation, social media product posts,
catalog creation.

---

## 3. Multi-Source Research Aggregator (HTTP Connectors → Synthesis → Output)

Pull data from multiple HTTP APIs (e.g. news, weather, stock prices) and
synthesize a briefing.

**Nodes:**
- `source` (news) — HTTP connector to a news API
- `source` (weather) — HTTP connector to a weather API
- `textGen` (synthesizer) — combines both sources into a morning briefing
- `sink` — final briefing

**Edges:**
- `news → synthesizer` (flow)
- `weather → synthesizer` (flow)
- `synthesizer → sink` (flow)

**HTTP connector config (news):**
```json
{
  "type": "http",
  "http": {
    "url": "https://newsapi.org/v2/top-headlines?country=us",
    "method": "GET",
    "headers": { "Authorization": "Bearer YOUR_KEY" },
    "extract": ["articles.0.title", "articles.0.description", "articles.1.title"]
  }
}
```

**Use when:** daily briefings, market research, competitive intelligence,
status dashboards.

---

## 4. Video Ad Generator (Script → Voiceover → Video → Output)

Generate a short video ad: write a script, synthesize voiceover, generate
video, assemble output.

**Nodes:**
- `source` — product / brand brief
- `textGen` (scriptwriter) — writes a 15-second ad script
- `audioGen` — TTS voiceover from the script
- `videoGen` — generates video from the script + product brief
- `sink` — final ad package (script + audio + video)

**Edges:**
- `source → scriptwriter` (flow)
- `scriptwriter → audioGen` (flow)
- `scriptwriter → videoGen` (flow)
- `audioGen → sink` (flow)
- `videoGen → sink` (flow)

**AudioGen config:**
```json
{ "model": "tts-1", "voice": "alloy", "format": "mp3", "speed": 1.0 }
```

**VideoGen config:**
```json
{ "model": "video-gen", "duration": 15, "aspect": "9:16", "n": 1 }
```

**Use when:** social media ads, product demos, TikTok/Reels content,
promotional videos.

---

## 5. Form-Driven Content Generator (Form → Writer → Output)

A reusable template where the user fills a form before each run. The form
answers become the source input.

**Nodes:**
- `source` — form connector with fields
- `textGen` (writer) — generates content from form answers
- `sink` — output

**Edges:**
- `source → writer` (flow)
- `writer → sink` (flow)

**Form connector config:**
```json
{
  "type": "form",
  "form": {
    "fields": [
      { "name": "topic", "label": "文章主题", "required": true },
      { "name": "audience", "label": "目标读者", "required": false },
      { "name": "tone", "label": "语气风格", "required": false },
      { "name": "wordCount", "label": "字数要求", "required": false }
    ]
  }
}
```

**Use when:** reusable content templates where each run needs different inputs —
blog post generator, email template, report generator, social media post
factory.

---

## 6. A/B Prompt Testing (Two Writers → Gate → Output)

Test two prompt variants against the same input and pick the winner via a
quality gate.

**Nodes:**
- `source` — input / topic
- `textGen` (writer A) — variant A prompt
- `textGen` (writer B) — variant B prompt
- `gate` (judge) — picks the better output based on `criterion`
- `sink` — winning output

**Edges:**
- `source → writerA` (flow)
- `source → writerB` (flow)
- `writerA → judge` (flow)
- `writerB → judge` (flow)
- `judge → sink` (flow)

**Gate config:**
```json
{ "maxAttempts": 1, "criterion": "Which output is more persuasive? Return the one with better hook and clearer CTA.", "onExhausted": "pass" }
```

**Use when:** prompt engineering, copy testing, headline optimization,
comparing model variants.

---

## 7. Scheduled Daily Report (Cron Trigger → HTTP Sources → Synthesis → Output)

A fully automated pipeline that runs every morning, pulls data from external
APIs, and generates a report.

**Nodes:**
- `source` (sales API) — HTTP connector
- `source` (support API) — HTTP connector
- `textGen` (analyst) — synthesizes a daily report
- `sink` — report

**Trigger:**
```json
{ "id": "daily-report", "type": "cron", "cron": "0 9 * * 1-5", "enabled": true }
```
Runs at 9:00 AM every weekday.

**Use when:** automated reporting, daily/weekly digests, status updates,
competitive monitoring.

---

## 8. Webhook-Triggered Content (Webhook → Writer → Output)

Trigger a run from an external webhook — e.g. when a new product is added to
your e-commerce platform, auto-generate its listing copy.

**Nodes:**
- `source` — receives the webhook payload as `sourceInput`
- `textGen` (copywriter) — generates listing from payload
- `sink` — output

**Trigger:**
```json
{ "id": "new-product-webhook", "type": "webhook", "webhookSecret": "your-secret-here", "enabled": true }
```

**Call it:**
```bash
curl -X POST http://localhost:8791/api/graphs/GRAPH_ID/webhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-secret-here" \
  -d '{"payload": {"name": "New Product", "price": 29.99, "category": "electronics"}}'
```

**Use when:** event-driven content generation, CMS integration, e-commerce
automation, CI/CD documentation generation.

---

## 9. Ops Weekly Report (HTTP → Code → Agent → Sink) — 内置 `tpl-ops-weekly`

拉取业务数据 → 代码节点清洗汇总 → AI 生成结构化周报。HTTP 拉取失败时走
`error` 边到兜底文坊（说明换 URL 的操作指引），流水线依然完整跑通。
代码节点给出通用清洗骨架（TODO 标注），换成自己的业务字段即可。

**Use when:** 数据运营周报、指标盘点、定期数据摘要。

---

## 10. Scheduled Patrol Alert (HTTP → Branch → Notify / Sink) — 内置 `tpl-patrol-alert`

健康检查 → 分支判断异常 → 飞书告警 / 正常记录。配合 cron 触发器即成定时巡检。
`webhookUrl` 留空，运行前在节点里粘贴自己的群机器人地址。

**Use when:** 服务巡检、证书到期监控、接口可用性告警。

---

## 11. Multi-Source Research Brief (HTTP ×2 → Parallel → Agent → Sink) — 内置 `tpl-research-brief`

两路 HTTP 拉取 → `parallel` 汇聚 → AI 交叉比对研判（一致信息 / 单源待确认 / 数据缺口）。
即示例 3 的代码化版本。

**Use when:** 情报汇总、多源交叉验证、研究简报。

---

## 12. Competitor Watch (HTTP → Code → Agent → Sink) — 内置 `tpl-competitor-watch`

拉取竞品页面 → 代码提取字段 → AI 对比摘要。拉取失败走 `error` 边兜底。
正则提取骨架需按目标页面结构替换。

**Use when:** 竞品动向监控、页面变更跟踪。

---

## Importing a Template

All templates are available in the board's **新建产线** dialog. Click it,
select a template, and the graph is created with all nodes, edges, and configs
pre-filled. You can then customize it for your use case.

To create your own template, design a graph in the board and export it as JSON
(via the graph API), then add it to `packages/core/src/templates.ts`（注意补 `Graph.parse`
可编译的 source/sink 与坐标，并在 templates.test 的全量编译断言覆盖下维护）.
