# 密钥轮换 Runbook（at-rest 主密钥）

> 对应设计：[design-key-rotation.md](../design-key-rotation.md)。适用于静态加密主密钥（`AGENT_WORLD_ENCRYPTION_KEY(S)` / `.encryption-keys`）的**定期轮换**与**泄露应急**。用户存的 provider key / search key 等业务凭证不在此列——那些是用户资产，主密钥轮换不改变它们的密文归属。

## 0. 前置知识：密钥从哪来

`at-rest.ts` 按以下优先级加载**有序 keyring**（第一个是加密密钥，其余仅解密）：

| 优先级 | 来源                                 | 形态                             |
| --- | ---------------------------------- | ------------------------------ |
| 1   | env `AGENT_WORLD_ENCRYPTION_KEYS`  | 逗号分隔，新在前：`<new>,<old>`         |
| 2   | env `AGENT_WORLD_ENCRYPTION_KEY`   | 单值 ≡ 单元素 keyring（旧写法，继续生效）     |
| 3   | `.encryption-keys` 文件（DB 同目录，0600） | JSON 数组：`["<new>", "<old>"]`   |
| 4   | `.encryption-key` 文件（旧单值）          | 自动包装成单元素 keyring               |
| 5   | 都没有                                | 首次启动生成新密钥并落 `.encryption-keys` |

密文格式（`keyId` = 密钥材料派生后前 6 位 hex）：

```
enc:v1:<iv>:<tag>:<cipher>          ← 轮换前的存量（无 keyId，解密逐个试 keyring）
enc:v2:<keyId>:<iv>:<tag>:<cipher>   ← 轮换后的新写入（按 keyId 路由）
```

**轮换原理**：keyring 换成 `[新, 旧]` 并重启后，新写入全部用新密钥；存量旧密文因旧密钥仍在 ring 里照常解密——读路径零中断。收敛（把存量重加密到新密钥）由脚本完成。

## 1. 定期轮换（建议 90 天一次）

```bash
# ① 生成新密钥（hex-64）
openssl rand -hex 32

# ② 把 keyring 改为「新在前，旧在后」
#    env 方式：
export AGENT_WORLD_ENCRYPTION_KEYS=<new-hex64>,<old-hex64>
#    文件方式：编辑 DB 同目录 .encryption-keys（保持 0600）
#    ["<new-hex64>", "<old-hex64>"]

# ③ 重启 server —— 新写入全部走新密钥，存量照常读
#    启动日志的 encryptionKeySource 只记来源（env|file），不泄密钥材料

# ④（建议 90 天窗口内）收敛存量密文到新密钥
cd packages/server
DB_FILE=/path/to/agent-world.sqlite \
AGENT_WORLD_ENCRYPTION_KEYS=<new-hex64>,<old-hex64> \
pnpm exec tsx scripts/rotate-reencrypt.ts --dry-run   # 先看会改多少行
#    确认数字合理后去掉 --dry-run 真跑；大库可分表：
#    ... rotate-reencrypt.ts --table=runs,graph_versions

# ⑤ 确认 residue 归零（脚本退出码 0）后，从 keyring 移除旧密钥
export AGENT_WORLD_ENCRYPTION_KEYS=<new-hex64>        # 或改 .encryption-keys 为 ["<new>"]

# ⑥ 再重启一次。旧密钥材料即可销毁
```

脚本行为要点（`src/key-rotation.ts`）：

- 覆盖全部五个密文面：`settings.data`、`publish_targets.config_encrypted`、`graphs.doc`、`graph_versions.snapshot`、`runs.snapshot`；

- **幂等**：已在新密钥上的行跳过——中断后直接重跑即可；第二遍跑必然零改动；

- **fail-closed**：遇到当前 keyring 解不开的行，报错点名 `表.主键` 并中止整个 run（绝不静默跳过）；补齐缺失密钥后重跑；

- 顺手把 whole-column 面上的**历史明文行**（lazy 迁移从未重写的）也封上；

- 退出码：`residue` 归零 = 0（可删旧密钥），有残留 = 1（旧密钥必须留着）；

- 密钥材料永远不进命令行参数，脚本从与 server 相同的 env/文件优先级加载。

## 2. 泄露应急

与定期轮换的差别只有三点：

1. 第 ④ 步**立即**执行，不等 90 天窗口（keyring 只保证新数据用新密钥，存量密文在旧密钥泄露下仍可被解）；
2. 用户级凭证（provider key / search key）**视为已泄露**，公告通知用户重置——静态加密挡不住持有密钥的攻击者，这是 [design-at-rest-encryption.md §2](../design-at-rest-encryption.md) 声明的威胁模型边界；
3. 同目录同暴露面的 `.jwt-secret` **连带轮换**（语义是强制全员重登，代价可接受）。

## 3. 常见错误

| 症状                                                      | 原因                                    | 处置                                            |
| ------------------------------------------------------- | ------------------------------------- | --------------------------------------------- |
| `unknown encryption key id: xxxxxx`                     | 密文是 v2 但 keyId 不在当前 keyring           | 把对应密钥加回 `AGENT_WORLD_ENCRYPTION_KEYS` 再试      |
| `could not be decrypted with the current keyring`（脚本中止） | 旧密钥已从 ring 移除但存量未收敛                   | 恢复旧密钥进 ring → 重跑脚本 → residue 归零后再移除           |
| 启动即报 `encryption keyring is empty` / `duplicate key id` | env 写法错误 / 两个密钥前 6 hex 撞了（概率 \~1/16M） | 检查逗号分隔写法；撞 id 换一把新密钥                          |
| 重启后旧数据读不出来                                              | 密钥文件被删或换新但没带旧密钥                       | 找回 `.encryption-keys` 备份；没有备份则数据不可恢复（这是加密的本意） |

## 4. 验证清单（每次轮换后）

- [ ] `rotate-reencrypt.ts` 输出 `residue: v1=0 old-key-v2=0` 且退出码 0

- [ ] 从 keyring 移除旧密钥重启后，登录、打开任一产线、跑一次 webhook 触发均正常

- [ ] `sqlite3 <db> "SELECT data FROM settings LIMIT 1"` 前缀是 `enc:v2:<新keyId>:`（不是 v1，也不是旧 id）

