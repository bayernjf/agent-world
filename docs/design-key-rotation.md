# 密钥轮换（Key Rotation）设计方案

> 状态：**方案设计，未实施**。承接 [design-at-rest-encryption.md §5](design-at-rest-encryption.md) 登记的「换 key 流程」，目标是对接合规要求（SOC 2 / ISO 27001 密钥管理条款：定期轮换 + 泄露应急）。
> 创建：2026-09-05

## 1. 背景与问题

现状是**单密钥** AES-256-GCM（`at-rest.ts`）：

- 密钥来源：env `AGENT_WORLD_ENCRYPTION_KEY` 或 `.encryption-key` 文件（0600，DB 同目录）；

- 密文格式 `enc:v1:<iv>:<tag>:<cipher>` 里的 `v1` 是**算法版本号，不是密钥代号**；

- 换 key 后存量密文全部 fail-closed 报错——无法解密，等于数据报废。

合规审计会问两个问题，当前都答不上来：

1. **定期轮换**：密钥多久换一次？——现状：不能换（换了旧数据锁死）。
2. **泄露应急**：怀疑密钥泄露后多久能完成轮换？——现状：无法在不丢数据的前提下轮换。

## 2. 设计目标

- 换 key 时存量密文**零丢失**、服务**不中断**（滚动轮换）；

- 一次轮换 = 改一个 env + 重启，可选跑一个重加密脚本收敛；

- 不破坏现有密文格式与 lazy 迁移语义（无前缀旧明文仍直通）；

- contentHash 链不受影响（hash 本就基于明文计算，与密钥无关）。

## 3. 方案设计

### 3.1 密钥环（keyring）+ 密钥代号

密文格式从「算法版本」升级为「**算法版本 + 密钥代号**」：

```
enc:v1:<iv>:<tag>:<cipher>          ← 现有格式（默认密钥，兼容）
enc:v2:<keyId>:<iv>:<tag>:<cipher>  ← 新格式（多密钥）
```

- `v2` 表示带 keyId 的封装格式；`keyId` 是密钥的短标识（如 `k2026a`，密钥材料派生时截取前 6 位 hex）。

- 解密：按 keyId 查 keyring；无 keyId（v1）→ 用主密钥。

- 加密：**永远用 keyring 里的第一个（最新）密钥**。

### 3.2 keyring 加载

env 从单值升级为**有序列表**（保持向后兼容）：

```bash
# 逗号分隔，第一个是当前加密用密钥，其余仅解密（历史密钥）
AGENT_WORLD_ENCRYPTION_KEYS=<new-hex64>,<old-hex64>

# 旧变量继续生效：AGENT_WORLD_ENCRYPTION_KEY 等价于单元素 keyring
```

`.encryption-key` 文件模式升级为 `.encryption-keys`（JSON 数组，0600），旧单值文件自动包装成单元素数组（lazy 迁移，同轮换语义）。

### 3.3 轮换操作流程（runbook）

```text
1. 生成新密钥：openssl rand -hex 32
2. env 改为 AGENT_WORLD_ENCRYPTION_KEYS=<新>,<旧>（新在前）
3. 重启服务 → 新写入全部用新密钥，存量旧密文照常解密（读路径不受影响）
4. （可选，建议 90 天内完成）跑重加密脚本收敛：
   node scripts/rotate-reencrypt.ts
   遍历 settings.data / graphs.doc / graph_versions.snapshot / runs.snapshot，
   逐行 decryptString（旧密钥）→ encryptString（新密钥）回写
5. 确认无旧密文残留（脚本自带扫描报告）后，从 keyring 移除旧密钥，再重启
```

### 3.4 重加密脚本要点

- 复用 `sealDocString` / `openDocString` / `decryptString` / `encryptString`，不另写第二套规则（教训见 at-rest §4.3：探测器与改写器分家就是漏修成因）；

- **幂等**：解不开的行（坏密文）停下报告，不静默跳过；

- 逐行事务，中断可续跑（按主键游标）；

- 大库（runs 快照多）支持 `--table` 分批。

### 3.5 泄露应急（与定期轮换的差异）

密钥泄露时风险在于**存量密文可被解密**——轮换 keyring 只保证「新数据用新密钥」，存量仍需第 4 步收敛。应急流程额外要求：

1. 轮换后**立即**跑重加密（不等 90 天窗口）；
2. 用户级凭证（provider key / search key）**视为已泄露**，通知用户重置——静态加密挡不住持有密钥的攻击者，这是 [design-at-rest-encryption.md §2](design-at-rest-encryption.md) 已声明的威胁模型边界；
3. 同时轮换 `.jwt-secret`（同目录、同暴露面）。

## 4. 分阶段落地

| 阶段 | 内容                                               | 依赖 |
| -- | ------------------------------------------------ | -- |
| P1 | keyring 加载 + `v2` 密文格式（加密新密钥 / 解密按 keyId），旧格式全兼容 | 无  |
| P2 | `scripts/rotate-reencrypt.ts` 重加密工具 + 扫描报告       | P1 |
| P3 | 运维文档（README/runbook 一节）+ 定期轮换建议（默认 90 天）         | P2 |

## 5. 测试计划

- keyring 多密钥：新写入用第一个密钥、旧密文可解、keyId 路由正确；

- 兼容：`AGENT_WORLD_ENCRYPTION_KEY` 单值 ≡ 单元素 keyring；`.encryption-key` 旧文件直读；

- 重加密脚本：round-trip 后明文不变、`enc:v2:` 覆盖率 100%、幂等（跑两遍第二遍零改动）、坏密文 fail-closed；

- 回归：`at-rest.test.ts` / `at-rest.db.test.ts` / `api.security.test.ts`（含 2026-09-05 新增的 settings 落库加密断言）全绿。

## 6. 边界与不做

- **不做自动后台轮换**：轮换是运维动作，自动改密钥 + 自动重加密在单机 sqlite 上风险大于收益；触发条件见 deferred-items；

- **不接 KMS**：单机/自托管形态下 KMS 引入外部依赖；多租户云托管时再评估（届时 keyring 抽象已就位，KMS 只是换一个 keyring 来源）；

- JWT secret 轮换不在本方案内（`auth.ts` 独立密钥，轮换语义是「强制全员重登」，方案更简单，另行登记）。

## 7. 相关文档

- [design-at-rest-encryption.md](design-at-rest-encryption.md) —— 静态加密本体（本方案的上游）

- [deferred-items.md](deferred-items.md) 安全/运维线 —— 触发条件登记

- [security-audit-2026-08-31.md](security-audit-2026-08-31.md)

