# Example Pipelines

A collection of ready-to-use graph templates. Each can be imported via the
board's **新建产线** dialog, or used as a starting point for your own.

---

## 1. Content Rewrite Loop (Draft → Critic → Rewrite → Output)

The classic quality loop. A writer drafts, a critic checks against a standard,
and on failure the draft goes back to the writer with the critic's feedback.

**Nodes:**
- `source` — input brief / topic
- `agent` (writer) — writes a first draft
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
- `agent` (copywriter) — writes title, description, bullet points
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
- `agent` (synthesizer) — combines both sources into a morning briefing
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
- `agent` (scriptwriter) — writes a 15-second ad script
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
- `agent` (writer) — generates content from form answers
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
- `agent` (writer A) — variant A prompt
- `agent` (writer B) — variant B prompt
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
- `agent` (analyst) — synthesizes a daily report
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
- `agent` (copywriter) — generates listing from payload
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

## Importing a Template

All templates are available in the board's **新建产线** dialog. Click it,
select a template, and the graph is created with all nodes, edges, and configs
pre-filled. You can then customize it for your use case.

To create your own template, design a graph in the board and export it as JSON
(via the graph API), then add it to `packages/server/src/templates.ts`.
