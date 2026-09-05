# 静态加密（At-Rest Encryption）设计方案 — 审计 L3

> 状态：方案已定稿，代码按两阶段落地。归属安全审计 [security-audit-2026-08-31.md](security-audit-2026-08-31.md) 的 L3 项。

## 1. 背景与目标

审计 L3 指出三类静态明文问题：

1. **API Key 明文存 sqlite `settings.data`** —— 每用户一行，`data` 为整个 AppConfig 的 JSON 字符串，含所有 provider 的 `apiKey`。
2. **webhook secret 明文存图文档** —— `graphs.doc`（当前图）、`graph_versions.snapshot`（版本快照）、`runs.snapshot`（运行快照）三处都以明文 JSON 存储 `triggers[].webhookSecret`。
3. CORS 危险组合 —— **已在 `c3f5eae` 修复**（本方案不再涉及）。

目标：让 secrets 在磁盘上不以明文存在，同时不改变 API 语义、前端无感知、兼容既有数据。

## 2. 威胁模型与设计取舍

| 威胁 | 说明 | 对策 |
|---|---|---|
| 磁盘丢失 / sqlite 文件被拷贝 | 最直接泄露面 | secrets 落盘前加密 |
| 备份文件泄露 | 备份的是 sqlite / 密钥文件 | 密钥文件 0600 与 DB 同目录，随备份一起丢失则同样泄露 → 建议密钥用 env 注入（见 §5） |
| 密钥文件与 DB 同机泄露 | 若攻击者同时拿到 DB + 密钥文件，加密失效 | 接受该边界：这是"静态加密"的固有上限，与 JWT secret 同级别 |

**关键取舍：字段级加密 vs 整文档加密。**
选**字段级**（仅加密 secrets 字段），理由：

- 图文档本身非秘密，密钥丢失不应导致**整图不可读**（字段级丢失只影响 secret 比对，图还能看）；
- 保持 sqlite 内图结构可读，便于调试与 SQL 分析；
- contentHash（版本↔运行关联）对字段值不敏感，密钥轮换不破坏 hash 链。

**算法**：`AES-256-GCM`（node:crypto 内置，认证加密，防篡改）。

## 3. 现状盘点（全部存取点）

### 3.1 settings（API Key）

- 存储：`settings(user_id, data, updated_at)`，`data` = AppConfig JSON。
- 唯一读写边界：`bindSettingsStore({ get, set })`（`index.ts:68-71`）→ `db.getSettings/saveSettings`。
- **加密切入：`index.ts` 绑定处**（get 后解密 / set 前加密），`config.ts` 零改动。
- `GET /api/settings` 的脱敏逻辑（`index.ts:627`）保持不变——脱敏发生在解密之后。

### 3.2 webhook secret（图文档）

| 表 | 写点 | 读点 |
|---|---|---|
| `graphs.doc` | `saveGraph`（db.ts:429） | `getGraph`（459）、`getGraphById`（1343） |
| `graph_versions.snapshot` | `saveVersion`（1300）、`saveAutoSnapshot`（1315） | `getVersion`（1294） |
| `runs.snapshot` | `createRun`（db.ts:533） | `getRun`（557）、`getRunById`（1371）、`getLatestRunContentHash`（1288，只算 hash 不 parse）、`getAbArmSnapshot`（1195）、成本/评估/缩略图裸 parse（945/1097/1195） |

**加密切入：db.ts 内部序列化边界**（所有 `JSON.stringify(graph)` 前 seal、所有 `JSON.parse(doc/snapshot)` 后 open），调用方（run.ts、ab.ts、调度器、index.ts 路由）零改动。

### 3.3 contentHash 匹配链（关键约束）

- `saveAutoSnapshot` 对**明文** snapshot 算 `contentHash`（1316）存 `graph_versions.content_hash`；
- `getLatestRunContentHash` 对 `runs.snapshot` 算 hash（1288）用于"该快照是否对应实际运行"标记。

**规则：hash 永远基于解密后（明文）doc 计算。** 这样 version 表与 runs 的 hash 可比较，且与加密形态无关。实现上 hash 在 seal 之前、open 之后计算。

## 4. 方案设计

### 4.1 密钥管理（`src/at-rest.ts`）

- 环境变量 **`AGENT_WORLD_ENCRYPTION_KEY`** 优先：hex（64 位，32 字节）或任意字符串（sha256 派生为 32 字节）。
- 未设置时：持久化 `.encryption-key` 文件（0600，与 sqlite 同目录），复用 `auth.ts loadSecret()` 的成熟模式。
- 密钥变更后果：已加密数据无法解密（fail-closed 报错），**运维文档明确：换 key = 需迁移或接受 secret 失效**（webhook 重配；provider key 重新录入）。

### 4.2 密文格式（可版本化、可轮换）

```
enc:v1:<iv base64>:<authTag base64>:<cipher base64>
```

- iv 12 字节随机、tag 16 字节、无前缀的旧值视为明文（向后兼容）。
- 版本号 `v1` 便于将来换算法/密钥重加密。

### 4.3 辅助函数

```ts
// src/at-rest.ts
export function encryptString(plain: string): string   // → enc:v1:...
export function decryptString(stored: string): string  // 无前缀原样返回；密文解密失败抛错
export function sealGraphDoc(graph: Graph): Graph      // 按字段名递归加密全部凭证（深拷贝，不改入参）
export function openGraphDoc(graph: Graph): Graph      // 反向；解密失败抛错
```

> **加密范围（`f7c333f` 起，不再是单字段路径）**：`SECRET_KEYS` 精确名单（`apiKey` / `secret` / `token` /
> `webhookSecret` / `webhookUrl` / `authorization` / `cookie` …）递归匹配图文档任意层级——节点级 provider key、
> notify 的 secret 与群机器人 URL、连接器 `auth.token`、trigger webhookSecret 全覆盖；
> **header 名由用户自定，名单枚举不可能穷尽**，故 `ff223bb` 起在任何 `headers` 记录内改按**名字模式**
> （`AUTHISH_HEADER`：auth / token / key / secret / credential / signature / password / session / cookie / bearer）
> 加密其值，良性 header（`Content-Type` 等）保持明文以便排查。
> **URL 查询串里的凭证**（`?access_token=…`、Azure 的 `?api-key=…`）由 `043ce5c` 收口：字段名命中 `URL_KEYS`
> 时按 `QUERY_SECRET` **精确匹配参数名**（不用子串，否则 `author` 含 auth、`keyboard` 含 key 会被误封），
> **只封参数值、保留 host/path/良性参数可读**；密文内嵌进 URL 时必须 `encodeURIComponent`（base64 里的 `+`
> 会被服务端解成空格），所以盘上原始字节看到的是 `enc%3Av1%3A`。
> 两条不变量：键顺序不变（明文 contentHash 可比）、无凭证的文档返回**同一引用**（零成本、身份不变）。
> 另注：原先独立的 `containsSecret` 探测函数已删除——探测器与改写器各写一份规则，正是 L3 首轮修复漏掉
> 全部节点级 key 的成因；现在 seal/open 共用同一次遍历。

### 4.4 接入点

**settings（index.ts 绑定处）：**

```ts
bindSettingsStore({
  get: (userId) => {
    const raw = db.getSettings(userId);
    return raw ? decryptString(raw) : null;   // 旧明文自动兼容
  },
  set: (userId, data) => db.saveSettings(userId, encryptString(data)),
});
```

**webhook secret（db.ts 序列化边界）：**

| 函数 | 改动 |
|---|---|
| `saveGraph` | `JSON.stringify(sealGraphDoc(graph))` |
| `getGraph` / `getGraphById` | `openGraphDoc(JSON.parse(row.doc))` |
| `saveVersion` / `saveAutoSnapshot` | 落库前 seal（hash 用原明文算，不变） |
| `getVersion` | open 后返回 |
| `createRun` | `JSON.stringify(sealGraphDoc(args.graph))` |
| `getRun` / `getRunById` / `getAbArmSnapshot` / 945 / 1097 / 1371 | open 后使用 |
| `getLatestRunContentHash` | open 后算 hash |

> 版本恢复（index.ts:1256）走 `getVersion`（已 open）→ `saveGraph`（再 seal），链路自洽。

## 5. 部署与运维

- **推荐**：生产注入 `AGENT_WORLD_ENCRYPTION_KEY`（env），避免密钥文件随 sqlite 一起备份泄露。
- 本地开发：不设 env，首次启动自动生成 `.encryption-key`（0600），sessions 不丢。
- `.gitignore` 应包含 `.encryption-key`（若 DB 目录在仓库内）。
- **换 key 流程**：方案已定稿 [design-key-rotation.md](design-key-rotation.md)（keyring + 重加密脚本，2026-09-05），实施仍缓做（登记 deferred-items）；在实施前，用 `encryptString/decryptString` 写一次性迁移脚本仍可行。

## 6. 测试计划

1. `at-rest.test.ts`：
   - 加密/解密往返；
   - 密文格式前缀 `enc:v1:`；
   - 旧明文兼容（无前缀原样返回）；
   - 坏密文 / 篡改 → 抛错（fail-closed）；
   - `sealGraphDoc` 不改入参（深拷贝）、无 triggers / 空 secret 零改动。
2. db 集成测试：
   - `saveGraph → getGraph` 后 webhookSecret 往返一致；
   - `saveVersion → getVersion → restore` 后 secret 一致；
   - `createRun → getRun` 一致；`getLatestRunContentHash` 与 version 表 hash 匹配；
   - 加密后 sqlite 原始字符串不含明文 secret（直接查 DB 断言）。
   - 后续追加：`?access_token=` / `?api-key=` 类 URL 凭证（`043ce5c`）、`search.apiKey` / `vcs.token` /
     `vcs.baseUrl?access_token=`（`75f02b4`）——八处明文凭证 × ≥4 份原始存储副本。
3. 全量回归：方案落地时 546 用例 + typecheck；收口时实测 core 164 / server 664 / web 32 + `pnpm -r typecheck`。

## 7. 验收标准

- [x] sqlite 中四张表（settings / graphs.doc / graph_versions.snapshot / runs.snapshot）无明文 API Key 与 webhookSecret；
- [x] API 语义不变：settings 读写、图保存/加载、版本预览/恢复、运行审计全部正常；
- [x] 新旧数据兼容：既有明文库升级后功能不受影响（lazy 迁移：下次写入自动加密）；
- [x] 全量测试通过、typecheck 通过。

## 8. 残余风险与后续

- **阶段划分**：settings + `graphs.doc` + `graph_versions.snapshot` 为本轮核心（L3 主目标）；`runs.snapshot` 因读取点分散（含成本/评估/缩略图裸 parse）在方案中一并设计，随代码落地验证。
- 明文 secret 仍短暂存在于**内存**（运行期比对、fireWebhook），这是功能必需，不属静态加密范畴。
- `config.json` 文件基线（无 user 的共享配置）仍为明文（0600 权限），属既有设计（团队共享基线），不在本轮范围。
- ~~**残留边界（`ff223bb` 后）**：http 节点 / 连接器 `url` 查询串里内嵌的凭证仍明文落库~~ → **已收口 `043ce5c`**：
  按字段名命中 `URL_KEYS` 后逐参数判定（见 §4.3），只封凭证参数的值、endpoint 与良性参数保持可读。
  选择"就地封值"而不是方案里提过的"把 query 凭证搬进 `headers`"：后者要改写请求语义，bot/Azure 这类
  **只认 query 参数**的端点会直接失效；封值不改变 URL 结构。
- **`f914fa9`/`75f02b4` 后新增的凭证入口自动被覆盖**：`search.apiKey`、`vcs.token` 的字段名本就在
  `SECRET_KEYS` 内，`vcs.baseUrl` 在 `URL_KEYS` 内，因此节点级密钥无需再改 sealer 即已加密；
  db 集成用例把这三处（含 `baseUrl?access_token=`）一并计入盘上原始字节断言。
- **仍然拦不到的**：写进自由文本的密钥——agent 的 prompt/`variables`、code 节点脚本正文、http 节点
  body 里的字符串。这些位置按定义无法区分"密钥"与"普通文字"，静态加密不覆盖，属于使用侧约束
  （文档与 Inspector 提示都引导用户把凭证放在专用字段里）。
- **不在范畴内的一条**：API 返回给已登录用户的图 JSON 始终是明文（应用要用），静态加密只保证**盘上**
  与**备份**不含明文；本项目也没有"图导出成文件"的功能，导出仅在 CSV（成本/评估）语境出现。

## 9. 相关文档

- [security-audit-2026-08-31.md](security-audit-2026-08-31.md) — L3
- [design-key-rotation.md](design-key-rotation.md) — 密钥轮换（承接本方案 §5 的换 key 流程）
- [design-audit-log.md](design-audit-log.md) — 审计日志（同批合规补强）
- [deferred-items.md](deferred-items.md) — 重加密工具 / key 轮换（登记）
