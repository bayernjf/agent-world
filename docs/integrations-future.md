# 未来集成（Phase 3 剩余）接口草案

> 已落地：飞书/钉钉/企微/Slack 群机器人 + SMTP 邮件（`notify` 节点）、GitHub/GitLab（`vcs` 节点）、cron/webhook/event/batch 触发器、http 节点可调任意 API 兜底。
>
> 本文记录**尚未实现**的集成的接口草案与入手路径，便于后续按需补齐——schema 先定，实现后填。

---

## 1. Notion

**场景**：把 agent 产出的内容写到 Notion 数据库一行 / 新建一个页面。

**节点草案**：`NodeKind.notion`，`NotionConfig`：

```ts
{
  action: z.enum(["create_page", "append_block", "query_database"]),
  databaseId: z.string().optional(),   // create_page / query_database
  pageId: z.string().optional(),        // append_block
  properties: z.record(z.unknown()).optional(),  // create_page 的列值
  blocks: z.array(z.record(z.unknown())).optional(), // append_block 的块
  source: z.string().optional(),        // 上游 text → 作为页面正文/块内容
}
```

**env**：`NOTION_API_KEY`（internal integration token，`secret_` 开头）。

**API**：
- create_page: `POST https://api.notion.com/v1/pages` body `{ parent: { database_id }, properties, children }`，headers `Authorization: Bearer ${key}`, `Notion-Version: 2022-06-28`
- append_block: `POST https://api.notion.com/v1/blocks/{pageId}/children`
- query_database: `POST https://api.notion.com/v1/databases/{databaseId}/query`

**入手**：照 `vcs.ts` 模式建 `notion.ts`（adapter + withRetry + NotionAuthError/NotionProviderError），engine 加 `node.kind === " notion"` 分支。properties 结构较繁（每个列要按类型包裹），第一版可只支持 `title` + `rich_text` 两类属性，其余透传。

---

## 2. Linear

**场景**：把 agent 总结的问题自动建一个 Linear issue。

**节点草案**：`NodeKind.linear`，`LinearConfig`：

```ts
{
  action: z.enum(["create_issue", "list_issues", "update_issue"]),
  teamId: z.string().optional(),       // create_issue
  title: z.string().optional(),        // create_issue 标题，留空用上游 text
  description: z.string().optional(),  // create_issue 描述，留空用上游 text
  state: z.string().optional(),        // update_issue 状态
  issueId: z.string().optional(),      // update_issue
}
```

**env**：`LINEAR_API_KEY`（personal API key）。

**API**：Linear 是 GraphQL（`https://api.linear.app/graphql`）。createIssue mutation：

```graphql
mutation { issueCreate(input: { teamId, title, description }) { issue { id url } } }
```

**入手**：GraphQL 单端点，照 `vcs.ts` 建一个 `linear.ts`，所有动作都是 `POST /graphql` 带 `Authorization: ${key}`。注意 GraphQL 错误结构（`errors: [{ message }]`）与 REST 不同，readJson 要兼容。

---

## 3. 邮件收件 / 附件

**场景**：新邮件触发产线（邮件客服、附件自动入库）。

**性质**：这是**触发器**而非动作节点——应纳入现有触发器体系（`triggers.ts` 的 type 枚举加 `"email"`），不是新 NodeKind。

**触发器草案**：`TriggerConfig` 加 `type: "email"`：

```ts
{
  type: "email",
  mailbox: z.string(),          // IMAP 账号标识（env 里 IMAP_HOST/USER/PASS 按 mailbox 取？或单账号）
  folder: z.string().default("INBOX"),
  since: z.string().optional(),  // 仅处理 N 分钟内的邮件
  subjectFilter: z.string().optional(),  // 正则匹配主题
  fromFilter: z.string().optional(),
}
```

**实现**：用 `imapflow`（纯 JS IMAP 客户端）轮询文件夹 unseen 邮件，解析附件（`mailparser`），去重（按 UID 记录已处理），新邮件 → 触发对应 graph，邮件正文/附件作为 source artifact。

**env**：`IMAP_HOST` / `IMAP_PORT` / `IMAP_USER` / `IMAP_PASS`。

**入手**：在 `scheduler.ts` 加 `type === "email"` 的轮询分支（不同于 cron 的 setTimeout，IMAP 用 idle 或定时 poll）。复杂度高于其他集成——IMAP 连接管理、去重、附件解析都是独立子问题。建议作为独立里程碑。

---

## 4. 内容平台（小红书 / 抖音 / 淘宝）

**场景**：发布生成的内容到内容平台。

**关键约束**：
- 官方 API 需**商家/创作者资质审核**，agent-world 无法自带凭证
- 非官方爬虫**合规风险高、反爬严、不稳定**

**建议形态**：**不建原生节点**，走「连接器市场」——用户自带凭证，平台 adapter 由用户/第三方提供。Phase 5「节点市场」的自然落点。

**若必须做的临时路径**：用 `http` + `code` 节点调各平台开放 API（如已拿到商家授权），把凭证放 env。schema 不在 core 固化，避免为未稳定的 API 承诺接口。

**各平台官方 API 入口**（供后续评估）：
- 小红书：开放平台 https://open.xiaohongshu.com/（笔记发布需企业号）
- 抖音：开放平台 https://developer.open-douyin.com/（视频发布 / 图文发布）
- 淘宝：开放平台 https://open.taobao.com/（商品/店铺 API）

---

## 5. Bitbucket / Gitea 等 VCS

直接扩展 `vcs` 节点：`VcsConfig.provider` 加 `"bitbucket" | "gitea"`，`vcs.ts` 加对应 adapter。Bitbucket Cloud REST v2.0、Gitea API 与 GitHub 同构，迁移成本低。

---

## 6. 通用集成节点的演化方向

当 provider 数量增多（>6），考虑把 `vcs` / `notify` / `notion` / `linear` 收敛为一个**通用 `integrate` 节点**：

```ts
IntegrateConfig = {
  provider: z.enum(["github", "gitlab", "slack", "notion", "linear", ...]),
  action: z.string(),  // 各 provider 自定义合法值
  options: z.record(z.unknown()),  // provider 特定字段
}
```

trade-off：节点数少但 schema 松散（type-safe 程度下降）。**建议保持当前每类一节点**直到 provider 真的多到管理负担，再重构——避免过早抽象。
