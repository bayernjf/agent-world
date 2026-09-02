# 知识提取与记忆系统（Knowledge / Archive）设计

> **状态：已落地**（2026-09-01 文档-代码覆盖盘点时补录设计文档；代码先行，见下文实现位置）。
> 定位：run 结束后自动提取知识入库，agent 节点可挂 `archive_search` 技能卡检索历史经验——让系统从"一次性流水线"变成"积累并复用经验"的体系。对应 technical-design.md §3.4 的 Knowledge 层设想（原列为阶段 5 演进，实际已提前实现）。

---

## 1. 目标与范围

- **写入侧**：run 成功结束（引擎状态 `done`）时，自动从事件流提取知识条目入库；用户也可在知识面板手动增删。
- **读取侧**：① 知识面板（KnowledgePanel）浏览 / 全文检索 / 删除；② agent 节点挂 `archive_search` 技能卡，在运行中检索过往知识作为上下文。
- **隔离**：所有读写按 `user_id` 过滤，与账号体系一致。

## 2. 数据模型（`packages/server/src/memory.ts`）

```sql
knowledge (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',   -- run_id / graph_id / 'manual'
  tags TEXT NOT NULL DEFAULT '[]',          -- JSON 数组
  created_at INTEGER NOT NULL,
  user_id TEXT                              -- 用户隔离
)
```

- **全文检索**：FTS5 虚拟表 `knowledge_fts`（title/content/tags），`content='knowledge'` 外部内容表 + `knowledge_ai/ad/au` 三个触发器同步。FTS5 不可用时**优雅降级**为 LIKE 查询（`ftsAvailable` 开关）。
- 后端实现 `SQLiteMemoryBackend`，通过 `setMemoryBackend()` 注入 skills registry（server 启动时装配）。

## 3. 提取规则（`extractKnowledgeFromRun`）

输入 run 全量事件流，**best-effort、永不抛**，跳过过短/空条目：

| 事件 | 提取条件 | 生成的条目 |
|---|---|---|
| `node.finished` | output 为字符串且长度 > 50 | 标题「{graphName} — {nodeId} 产出」，正文截取前 4000 字符，tags 含 `run-output` |
| `gate.verdict` | reason 长度 > 20 | 标题「{graphName} — {nodeId} 质检结论（通过/未通过）」，tags 含 `judge` |

- **触发时机**：run 结束且状态为 `done`（成功契约与触发器层一致，见 design-triggers §3）时，在 server 侧提取并 `memory.add()`。
- 知识条目的 `source` 记 run_id，可回溯到产线与运行。

## 4. API（`packages/server/src/index.ts`，均按登录用户隔离）

```
GET    /api/knowledge            列表（?limit &offset，返回 entries + total）
GET    /api/knowledge/search     全文检索（?q=）
POST   /api/knowledge            手动新增 { title, content, tags? }
DELETE /api/knowledge/:id        删除（仅本人条目）
```

## 5. 运行期检索：`archive_search` 技能卡（`packages/server/src/skills/registry.ts`）

- 技能 id `archive_search`，运行中把查询词交给 `SQLiteMemoryBackend.search()`，返回当前用户的知识条目。
- 权限模型沿用 skill 体系契约（见 core `skill.ts` 头注释与 extending.md §3）。

## 6. 前端（`apps/web/src/components/KnowledgePanel.tsx`）

知识面板：列表 / 检索 / 手动新增 / 删除。入口在主界面侧栏。

## 7. 边界与缓做

- 提取是**关键词启发式**（长度阈值 + 截断），不做摘要压缩——大量 run 的知识膨胀治理（去重 / 摘要 / 容量上限）待真实使用后按需做。
- 跨 run 知识关联 / graph 级知识视图：低优，见 deferred-items.md。
