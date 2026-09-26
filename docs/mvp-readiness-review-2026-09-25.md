# agent-world 项目级 MVP 评审（2026-09-25 更新版）

> 评审性质：项目级功能性 / 完整度 / 可上线性评审，硬标准 = **产品核心完全可用的 MVP**。
> 评审基线：2026-09-22 评审报告 + 本轮对代码/文档/CI 的一手核查。
> 评审环境：`feature/20260824 @ 7fec506`（本机未 push 部分见 §2）；Hasee 生产 = `main @ 0a4cbda`（经 GitHub API 实读 `gh run view 36108572366`）。
> 前版：[mvp-readiness-review-2026-09-22.md](./mvp-readiness-review-2026-09-22.md) · [2026-09-21.md](./mvp-readiness-review-2026-09-21.md)
> **取证纪律**：本篇每一条结论都有本机命令输出或源码行号支撑；无法自证的（现网日志、真机走查、并行会话的口头结论）一律写进 §8 并标注证据等级，不参与判定。

---

## 1. 结论（先给判定）

| 口径 | 判定（09-25 当时） | 一句话理由 |
| --- | --- | --- |
| **个人 / 小团队自托管 MVP** | 🟡 **功能核心可用，但不签「完全可用 + 可直接上线」** | 主链六环真实存在、35/36 模板零配置可派发；但**终点环节有一处静默失败**（sink 空输入照样产出"成品"），另有 A/B 口绕过派发校验、远程 MCP 绕过自家 SSRF 闸、已跟踪文档里有一条明文服务器口令 |
| **对外商业 SaaS** | ❌ **不达标（比 09-22 版记录的更严格）** | 除既有的收款未真机 / 无 HTTPS 流程 / 单实例假设外，本轮新增：账号无密码找回与删除导出、订阅门禁默认关且新部署无声明、`/metrics` 无鉴权且进程绑全网卡、会话令牌服务端不可撤销 |

补齐 §3 的 ①②③④ 四条，我自认可以签「自托管核心完全可用 MVP」；这四条都是**小改动 + 已有同仓先例**，不是架构问题。

> ⚠️ **本表是 09-25 当时的判定，已被 [§9.5 追评（2026-09-26）](#9-追评2026-09-26-上午四个前置的复核结果与修订判定) 修订**：四条前置里的三条代码项已闭合、判定升为 ✅（附两个运维签字）。以 §9.5 为准，本节留作过程记录。

---

## 2. 自 09-22 评审以来的关键变化

**内置模型目录与插拔（本会话，三原子 commit）**

| commit | 内容 | 真实落地状态（实测） |
| --- | --- | --- |
| `9c7c5f1` | 规则 A：模型下架 / provider 停用 / 类型未实现 / 空模型名 不再降级成 fake worker，改抛具名错误 | **已 push 到 dev**（PR #425，07:34Z 合并），**未进 main** |
| `54acc50` | provider worker 缓存 key 改为整份 provider（修「改单价不重启不生效」） | 同上（在 PR #425 内） |
| `7c0dbe0` | 规则 B：`model:""` = 跟随当前默认，只在 `startRun` 解析；模板 59 处模型字面量改槽位；删除 web「打开产线自动重写模型并存盘」 | 仅本机 |
| `7fec506` + 本篇 | 文档 | 仅本机 |

> **因此 `handoff.md` 本批条目里「未 push、未部署」这句对 ①② 不成立**（见 §5 更正项 4）。生产（main `0a4cbda`）不含 ①②③。

**零配置可用度（实测，非推算）**：临时探针把 36 个模板逐个 `instantiateTemplate → resolveModelSlots → validateModels`（`loadConfig(undefined)`，即只有内置 `DEFAULT_CONFIG`）——**35 可派发 / 1 被拒**，被拒的是 `tpl-news-podcast`，原因：其 `ttsModel` 字段默认值钉着 `tts-1`（`packages/core/src/templates.ts:1424`），而内置目录只有 text/image/video 模态（`packages/server/src/config.ts:312-319`），于是规则 A 生效后派发 422「模型「tts-1」已不可用」。这与该模板注释里写明的设计意图相反（无 TTS 能力时 `audioGen` **软跳过**、e5 旁路照样交付完整文稿，`templates.ts:1477-1481`）。→ 需拍板（§7 决策 D-1）。

---

## 3. 本轮新增的上线阻断项（每条都经一手复验）

### ① sink 空输入照样记 `done` 并产出一个空"成品"——**终点环节的静默失败**

`sinkNode` 取到上游 input 后**没有任何空值守卫**：直接 `setTextArtifact` → `states.set(nodeId,"done")` → `emit node.finished` → `produceArtifacts(...)`（`packages/server/src/nodes/sink.ts:11-17`）。空产物仍会落库为 `role:"final"`、`sizeBytes:0` 的成品行，run 报 `done`，用户在成品库看到一条**打不开/空白的成品**。

同族节点已经有正确写法可抄：`publishNode` 对同一 `inputFor` 的结果做了 `if (!output.trim())` 并 `node.failed` + `errorCode:"VALIDATION"`（`packages/server/src/nodes/publish.ts:17-27`，本次读证）。**这就是本项目反复清扫的"静默成功"缺陷类在核心链路上的最后一处。**

### ② A/B 实验口仍绕过派发校验（`validateModels` 命中数实测 0）

`ab.ts` 自建 run、不经 `startRun`。本批已给它补上模型槽解析与 `defaultModel`（顺带修掉「实验永远用 `engine.ts:1653` 写死的 `?? "agnes-2.0-flash"`」这一既有缺陷），但**仍缺 `validateModels`**：与 ① 那条模板问题叠加时后果具体——一条音频槽无模型可跟的图，正常派发被 422 拦住，进实验则直接起跑、每条 arm 静默无产物。跨切面检查只挂在一条路由上，是这个项目第三次扫出同一形状。

### ③ 远程 MCP 绕过项目自己的 SSRF 闸

`mcp.ts` 用**裸 `fetch`** 连用户配置的远程 MCP 端点：`packages/server/src/mcp.ts:237`、`:306`（以及 `:361`、`:378`）；URL 来源是 `PUT /api/settings` 写入的 `mcpServers`（`packages/server/src/index.ts:1885-1886`），**保存与连接两处都没有内网校验**。对照：`nodes/http.ts:5,98` 明确把所有出口走 `guardedFetch`（DNS 固定 + 拒绝内网，`ssrf.ts`），且 `ssrf.ts` 已被 http / search / publish / vcs / providers / engine 采纳——**只有 MCP 这条路没接**。后果：任何注册账号都能让服务端去连 `127.0.0.1` / `169.254.169.254`。修法就是把 `mcp.ts` 的 fetch 换成 `guardedFetch`，属机械收口。

### ④ 已跟踪文档里有一条明文服务器口令

两处命令内联了该服务器的**真实 sudo 口令**（形如 `ssh hasee-2016-server 'echo "<口令>" | sudo -S …'`，本文一律不复述真值）：

```
docs/production-ops.md:189   直接改 DB 的 node -e 命令
docs/production-ops.md:199   systemctl restart agent-world
```
两文件均在版本控制内（`git ls-files` 确证），口令文本由 commit `2aa40b15` 引入；同族的 `docs/design-monetization-m2-implementation.md:631` 用的是 `<pw>` 占位符——**说明写的时候知道该脱敏，是漏的而不是不懂**。gitleaks 不覆盖这个形态，所以既有"gitleaks 无泄露"结论对这条无效。**处理必须两步**：文档去敏（我做）+ 该口令轮换（只能你做，因为线上仍在使用）。→ **09-26 改判：只做了第一步，第二步由用户明确决定不做，转为接受风险，理由与边界见 §9.6。**

### ⑤ 部署声明层欠账：照 `.env.example` 复制出来的是一个"无门禁"实例

实测计数：`.env.example` 只有 **8** 个非注释变量赋值行，而 server 非测试代码实际读取 **77** 个不同 `process.env.*`。缺的恰好是决定安全与计费的那些：

| 变量 | 不设时的真实行为 | 证据 |
| --- | --- | --- |
| `MONETIZATION_ENFORCE` | 空 = **off**：订阅/配额完全不拦，free 层 `tokens:0` 形同虚设 | `packages/server/src/dispatch-gate.ts:29-39`、`packages/core/src/plans.ts:34` |
| `ALLOW_DEMO` | 关 → 判据矩阵里「获客：一键 demo 体验」在全新部署为 ❌ | `index.ts:442-445` |
| `ALLOW_REGISTRATION` | 模板里**未注释地写着 `=1`**，与设计意图（默认关）相反 | `.env.example:34` ↔ `index.ts:487-492` |
| `ERROR_REPORT_WEBHOOK_URL` | 无 sink；错误缓冲是**内存 100 条、重启即空** | `index.ts:4256`、`errors.ts:68` |
| `AGENT_WORLD_BUDGET_BYPASS` | 存在一个可静默关掉月度预算硬熔断的开关，**文档与模板均未收录** | `run.ts:158` |
| `NODE_ENV` / `SECURE_COOKIES` | runbook 的 systemd 段两者都不设 → 上了 HTTPS 之后 cookie 仍无 `Secure` | `index.ts:354-358` ↔ `docs/runbooks/deploy-ubuntu-server.md:146-147` |
| `WORKERS_DIR` | 默认自动装载 `dist/workers` 下任意插件文件（非 test 即加载），判据文档零提及 | `index.ts:145`、`index.ts:4123` |
| `STRIPE_*`（三个） | 收款总开关，模板与部署手册出现 **0 次** → 「待 key」容易被读成「填上就行」 | `stripe.ts:15-17` |

### ⑥ 账号生命周期三缺（grep 实测生产代码 0 命中）

无密码找回、无邮箱验证、无「删除账号 / 导出我的数据」路径（`deleteUserCascade` 只活在 driver 层、全仓无调用方：`sqlite-driver.ts:1218`）。另**会话服务端不可撤销**：无 session/jti/tokenVersion，登出只清 cookie（`index.ts:551-559`），改密不废旧令牌，泄漏令牌最长 7 天有效。对个人自托管是小事，对 owner 单账号是"忘密即全站锁死"，对外是合规硬缺。

---

## 4. 质量门（本机 Node 24 实跑，非估算）

| 门 | 结果 |
| --- | --- |
| core | **346/346**（24 文件） |
| server | **1390 = 1386 通过 + 2 本机环境红 + 2 DOGFOOD 跳过**（164 文件）；2 红是 `engine.code.test.ts` 两条 python 出网用例，本机 `python3` 为 Xcode 许可 shim 所致（实测 `python3 -c` 返回许可提示），非回归 |
| web | **1968/1968**（105 文件，单独实跑全绿） |
| mcp-server | 71/71（3 文件，沿用同日实跑值） |
| 合计 | **3775** |
| typecheck | `pnpm typecheck`（四包 + `tsconfig.scripts.json`）全绿 |
| i18n | `i18n:check` 与 `i18n:prune --check` 均 0 未引用、0 值漂移 |
| CI | dev 分支含 ①② 的推送 **CI 绿**（run 36108309881）；**main 当前红**：run `36099799649`（`0a4cbda`）红在 `apps/web/src/components/CostReport.test.tsx:162` |

**注意这条口径**：3775 是"本机实跑"，而 CI 对 **main 目前是红的**（该用例与 CostReport/ProductGallery 同族，属并发负载抖动，本机隔离重跑即绿——但它意味着"CI 全绿"这句话今天不成立）。

---

## 5. 对既有判据文档的更正（5 条）

1. **「G4 长任务跨 run 续跑已全部落地」→ 应为「链路已落地，生产不可达」。** 入口闸门是 `supportsAsync = !!worker.submitVideoJob && !!worker.queryVideoJob`（`nodes/videogen.ts:200`），而生产唯一 worker `routingWorker()`（`index.ts:143` 的进程级单例）只返回 `runTextGen/judge/generateImage/generateVideo/generateAudio`（`providers/index.ts:108-194`），**不含这两个方法**；全仓 `submitVideoJob` 的实现只存在于测试替身 `engine.videogen.async.test.ts:36`。后果：degrade+halt+reattach 分支、`remote_jobs` 表、admin 端点、web 三按钮在真实部署里永不触发，长视频仍无超时降级保护。需要改口径的三处：`handoff.md`（Active work/G4 段）、`docs/design-step-trace-and-robustness.md` §3.4、`docs/deferred-items.md`；讽刺的是同一张状态表 `design-step-trace-and-robustness.md` 自己写着「当前无 provider 实现，生产仍走同步 generateVideo」——**同一文档内部自相矛盾**。
2. **「对象存储属阶段 5 / 未做」→ 已实现，只是默认 local。** `packages/server/src/storage.ts:145` 的 `S3StorageBackend` + `:215` 的 `STORAGE_BACKEND=s3`，`storage.test.ts` 有覆盖，`artifact-store.ts:52` 已接。需更正：`mvp-readiness-review-2026-09-22.md:112`、`mvp-readiness-review-2026-09-21.md:30,93`。
3. **「权威全绿以 CI Linux（self-hosted runner）为准」→ runner 实为 GitHub 托管 `ubuntu-latest`**（`.github/workflows/ci.yml:12`），只有 `deploy.yml:16` 是 self-hosted。
4. **本批「未 push、未部署」对 ①② 不成立**（见 §2）：`gh pr view 425` 实读显示 `773cbfe`/`9c7c5f1`/`54acc50` 已合入 dev。
5. **M1 四条回采产线在仓内无可复现定义**：只有 `docs/production-ops.md:137-140` 的 graph_id/trigger_id 表 + 手搓 SSH/裸 SQL，没有 seed/fixture/迁移；「每日体检」是仓外的定时任务。**DB 一旦丢失即无法重建这四条产线**——判据文档应明确登记这个后果（或补一份 export/seed）。

---

## 6. Go / No-Go 判定矩阵

| 能力 | 自托管 MVP | 对外 SaaS | 证据 |
| --- | --- | --- | --- |
| 建产线 → 跑 → 出成品（文本/图片/视频） | ✅ | ✅ | 35/36 模板零配置可派发（实测探针）；`engine.*.test.ts` 30+ 文件；prod 有真实 run 记录（hearsay，见 §8） |
| 成品**不会静默为空** | ❌ | ❌ | §3①（`sink.ts:11-17` 无守卫） |
| 派发门禁覆盖所有入口 | 🟡 | ❌ | 8 个派发口已收口，A/B 缺 `validateModels`（§3②）、`resumeRun` **有意不拦**（既往决定，见 `dispatch-gate` 注释） |
| 模型层可插拔（换/增/删内置模型） | ✅（①② 已在 dev，③ 待部署） | 同左 | 本批三 commit + 回归测 |
| 服务端不外连内网 | ❌ | ❌ | §3③（MCP 裸 fetch） |
| 凭证卫生（仓库内无明文口令） | ❌ | ❌ | §3④ |
| 可观测性：有生产端 | ✅ | ✅ | `/metrics`（`index.ts:289`）、`/api/health` 真就绪门、`errors.ts` 环形缓冲 |
| 可观测性：有消费端（告警/探针） | ❌ | ❌（阻断） | 全仓无任何告警规则/看板部署物；`RUN_HALT_WEBHOOK`/`RUN_FAILED_WEBHOOK` 未配即静默（`notify.ts:18,52`） |
| 单实例假设已签字 | 🟡 未签 | ❌ | cron 进程内 `setTimeout`（`scheduler.ts:14`）、限流/metrics/错误缓冲全在进程 Map，无锁无选主 |
| 收款闭环 | n/a | ❌ | 代码在（`stripe.ts`/webhook 幂等/前端），缺 key + 收款主体；且 `checkout` 可买 10 席而 team 上限 5 席（`api.billing.ts:93` ↔ `plans.ts:37`） |
| 账号自助（找回 / 注销 / 导出） | 🟡 可接受 | ❌ | §3⑥ |
| 备份 / 恢复 | ✅ 备份，🟡 恢复 | 同左 | 备份脚本 + 实测记录存在；**恢复演练无可复用脚本**（只以 heredoc 形式存在于 runbook） |
| PG / 多副本 | 不阻断（SQLite 够用） | ❌ | PG 驱动在，但 CI 无 PG service、重加密与回滚脚本硬绑 SQLite |

---

## 7. 最短路径建议

**若目标 = 个人/小团队自托管正式日用**（按性价比排序，全做完 ≈ 一个小批次）：

1. ~~§3④ 文档去敏（我做）→ **你轮换那台机器的 sudo 口令**（只能你做）~~ → 第一步已做（`7b003f6`）；**第二步 09-26 由用户改判为「不轮换、接受风险」**，见 §9.6。
2. §3③ `mcp.ts` 的两处 fetch 换成 `guardedFetch`（机械收口，照 `nodes/http.ts` 抄）。
3. §3① `sinkNode` 加空 input 守卫（照 `publishNode` 的形状：`node.failed` + `VALIDATION`），并给 sink 补一条"上游为空 → 不产出 final 成品"的回归测。
4. §3② `ab.ts` 补 `validateModels`（与前两条同形状，属于已登记 deferred 的那张表）。
5. §3⑤ 把 §3⑤ 表里的 8 个变量补进 `.env.example` 并在部署 runbook 加一段"新部署必查清单"（含 `MONETIZATION_ENFORCE` 该开哪一档）；把 `.env.example:34` 的 `ALLOW_REGISTRATION=1` 注释掉。
6. §5 五条口径更正（纯文档）。
7. 部署 ③，让模板槽位与 Inspector 的「跟随默认」在真机跑一次（当前只到 dev）。

**决策 D-1（要你拍）**：`tpl-news-podcast` 在无 TTS 供应商时的行为——
- (a) 清空 `tts-1` 字段默认值 + 允许"音频空槽"降级为 warning（保留原设计的软跳过 + e5 旁路，零配置能交付文稿）；
- (b) 维持现状（必须先在设置里配一个音频模型，否则 422），并改模板注释与 checklist 口径。
我倾向 **(a)**：422 应该留给"用户钉了一个不存在的名字"，而不是"这个模态本来就可以缺席"。

**若目标 = 对外商业 SaaS**，在上面之外还必须：HTTPS/证书与 `NODE_ENV=production`（否则 cookie 无 `Secure`）、`/metrics` 收口（加鉴权或改绑回环）、真实告警消费端、账号找回与注销/导出路径、单实例水平扩展方案、Stripe 真机 Step6。

---

## 8. 证据等级与不采信清单

**证据等级**：本篇 §3/§5 的每一条都是**我本机执行或读码所得**（命令与行号在正文内）；prod 的 run 数、成本、部署健康度属**转述**（来自 handoff 体检记录，本会话未 SSH、未查库）。

**本会话派出的四份并行扫描中，两份的关键条目被源码逐条否证，已整份弃用**，记录如下以免后续评审再引用：

- 一份"账号/安全"扫描给出 5 条头条结论——存在两条无鉴权的 `share`/`embed` 公开产物端点、没有 logout 路由、管理员靠 `ADMIN_USER_IDS` env 白名单、改套餐无 HTTP 口、注册有邀请码——**全部不成立**：仓内无该两条路由（`grep 'app\.(get|post)\("/api/[^"]*(share|embed'` 在 src 下 0 命中）；登出是真路由（`index.ts:551`）；`ADMIN_USER_IDS` 全仓 0 命中而角色口是 `isOwner` 门禁（`/api/admin/users/:id/role`、`/plan` 均在）；`INVITE` 全仓 0 命中。**弃用。**
- 另一份扫描引用的 `production-ops.md` cron 频率冲突、以及若干行号我未能复现（`grep` 无命中）→ 不写入本篇。
- 采信的部分（G4 seam 死码、dist 缺 `.mjs`、明文口令、MCP 裸 fetch、resumeRun 例外、席位 10 vs 5、`.env.example` 覆盖面）全部经我逐条复验后进入本篇。

**未验证 / 别当已完成**：

1. 现网四条回采产线在 ①② 上线后的实际表现——**未 SSH、未查库**。规则 A 变严之后，任何钉着已不存在模型的产线都会从"跑起来再失败"变成"派发 422"；概率评估为低（四线用的是 agnes text/image/video，目录内都有），但这是唯一能证伪的判断，需要看一次 journalctl。
2. 本会话 ③（模板槽位 + Inspector「跟随默认」 + 打开产线不再改写模型）**未过一次 CI**，也未经任何浏览器视觉走查（本机起不了 vite dev、浏览器操作被策略拦）。
3. CI 的 `pnpm -r --if-present test -- --maxWorkers=1` 是否真的把串行意图传到 vitest，本会话只看到日志字面，未验证参数生效。
4. 3775 这个总数与其中 3691（core+server+web 的本机数）之外，mcp 的 71 沿用同日早前实跑值，本会话未重跑该包。

---

## 9. 追评（2026-09-26 上午）：四个前置的复核结果与修订判定

> 本节全部为**本机实测 + 一手读码**，不复述 PR/handoff 的说法。基线 `feature/20260824 @ 34b1aed`。

### 9.1 §7「签「自托管核心完全可用」之前必须补的四条」逐条复核

| # | 前置 | 复核方式 | 结果 |
| --- | --- | --- | --- |
| 1 | sink 空成品 | 本机跑 `nodes/sink.test.ts + engine.branch + phase1 + engine.reliability + engine.videogen.async` | ✅ **58/58 通过**。守卫收窄为「上游全是 branch/gate/媒体类 → done 但不归档；有内容型上游却产空 → failed + VALIDATION」；PR #429 原样实现的版本把 10 条合法拓扑打成 failed（CI run 36125520374），收窄提交 `34b1aed` 与之同 PR 合入，**不存在"线上了半个守卫"的中间态** |
| 2 | A/B 跳过模型校验 | `grep -c validateModels ab.ts` = **2**（含实际调用）；`ab.test.ts`/`api.ab.test.ts` 在全量里通过 | ✅ 闭合 |
| 3 | 远程 MCP 绕过 SSRF | `grep -c guardedFetch mcp.ts` = **5**，裸 `fetch(this.url` = **0** | ✅ 闭合（代价见 §9.4） |
| 4 | 文档明文口令 | 两处已在 `7b003f6` 去敏 | ✅ **不再是阻断**：09-26 用户明确决定不轮换，转为**已接受风险**（边界与理由见 §9.6） |

### 9.2 合并 / 部署事实（用 GitHub API 读，不采信文档）

- PR #429（feature → dev）**MERGED**，12:02Z，`headRefOid = 34b1aed`（含收窄）。
- PR #430（dev → main）合入，main 现为 **`eff8ebe`**；main CI `36133392082` **success**（昨天记的 CostReport 红不在这条口径上——它是并发负载抖动，**别当"已修复"**）。
- **Deploy 状态未确认**：最后一次成功部署是 12:04:29（早于 #430），针对 `eff8ebe` 的 workflow_run 尝试（`36133166811`）结论是 **skipped**。从本机 `curl http://192.168.31.14/api/health` 无返回（沙箱网络限制），**无法自证线上 commit**。→ 上线动作里必须有人 SSH 看一眼 `/api/health` 的 commit 字段。（**本段是 09-26 当日值，别当现状读**：同日稍后用 `git ls-remote` 直查远端，`origin/main` 已到 `9c5d764`、`origin/dev` = `1d894c8`，见 §9.6 更正版。）

> **✅ 09-26 下午 SSH 实测闭合（本条取代上一段的「无法自证」）**：从 MacBook `ssh hasee-2016-server` 直查，`curl -s http://127.0.0.1:8791/api/health` 返回
> `{"ok":true,"env":"staging","branch":"dev","commit":"93f6758","checks":{"db":"ok","jwtSecret":"loaded","encryption":"loaded","providers":{"agnes":"configured"}}}`；
> 部署目录 `/opt/agent-world` `git rev-parse --abbrev-ref HEAD` = **dev**、`git log -1` = **`93f6758`**（工作区干净，只有未跟踪的 `deploy.sh`/`rollback.sh`），与 health 自报一致。
> **单实例确认**：`ps` 只有 **1 个** `/usr/bin/node /opt/agent-world/packages/server/dist/index.js`（PID 710，ppid 1）——「只跑单实例」这条前置亦成立。
>
> **但「确认线上跑的是当前 main」这句口径本身是错的，应作废并改写**：Hasee 是 **staging，按分支映射（`feature/*` → `dev` → Hasee；`main` = PROD）跟踪 `dev` 而非 `main`**，health 自报 `branch:"dev"` 正是设计如此，不是落后。正确的等价命题是「线上跑的是 dev 尖端，且 dev 的内容已全部进入 main」，实测成立：`git ls-remote` 得 `origin/dev` = `93f6758`（= 线上，无落后）、`origin/main` = **`0d09cd5`**（已过 §9.6 记的 `9c5d764`），`git merge-base --is-ancestor 93f6758 0d09cd5` = **YES**——main 比 dev 多的 102 个提交里 **101 个是 dev→main 的 merge**，唯一的非 merge 是 `18e8c5b`（2026-09-09 dependabot 依赖升级，走了 main 直合路径，dev 上没有）。**结论：自托管口径最后一个前置已闭合；剩下那条「依赖升级只进了 main 没回 dev」的单向偏差异要单记一笔**（dev 上跑的依赖比 main 少一次 09-09 的 bump，属陈旧而非错误，触发条件：下次 dev 上出现与依赖版本相关的现象时回看）。

### 9.3 重测的门槛数字（2026-09-26）

core **346/346**（24 文件）· server **1397 = 1393 通过 + 2 本机 python-shim 环境红 + 2 狗粮跳过**（165 文件）· web **1968/1968**（105 文件）· mcp 71（沿用同日实跑，本轮未重跑）· `pnpm typecheck`（含 scripts）绿 · 零配置模板 **35/36 可派发**（探针实测，D-1 仍未拍：`tpl-news-podcast` 因 `ttsModel` 字段默认值钉 `tts-1` 报 422）。

> 本行是 §9 追评当时的读数。**同日 ④ 落地后四包同批复测 = 3817 / 300 文件**（core 346 · server 1427 · web 1973 · mcp 71），live 数字以 `handoff.md`「Quality gate」那一行为准。

### 9.4 本轮复核里发现/确认的事

1. **升级须知（新）**：MCP 现在经 SSRF 闸，**指向 `127.0.0.1` / 内网的远程 MCP 服务会被拒**，需 `ALLOW_PRIVATE_NETWORK=1` 才恢复（`ssrf.ts:162-163`）。这是安全修复的必然代价，runbook 与 `.env.example` 需各补一句，否则本地 MCP 用户会当成回归来报。
2. **sink 收窄的副作用我自查过，结论是无回归**：`role` 在 `run.ts:327-328` 按节点 kind 赋值，成品库走 `api.listArtifacts` 分页列**全部** artifact（`role` 只是返回列，不是过滤器）→ "路由/媒体终点不再落一行空 text"只意味着少了一张打不开的空卡，视频/图片成品行不受影响。
3. 仍然开着的、上一版就登记过的（逐条重验，未修）：**`build` 仍是纯 `tsc`**（`packages/server/package.json:9`）→ dist 缺 `src` 里那 4 个 `.mjs`，声明 subprocess 隔离的插件只在部署态静默 fail-closed，且 CI 从不覆盖 dist 启动路径；**`/metrics` 无鉴权**（`index.ts:289`）且 `serve()` 未给 hostname（绑全网卡）；**G4 异步 seam 生产仍不可达**（`providers/index.ts` 与 `openai-compatible.ts` 里 `submitVideoJob` 命中数均为 0）；**`WORKER=fake` 仍是无防护的 env 开关**（`providers/index.ts:94`，`.env.example` 已收录但未加生产 fail-closed）；账号侧无找回 / 无邮箱验证 / 无注销导出，会话令牌服务端不可撤销；收款未真机；单实例假设无锁。

### 9.5 修订判定

| 口径 | 判定 | 与 09-25 版的差别 |
| --- | --- | --- |
| **个人 / 小团队自托管** | ✅ **达到「产品核心完全可用的 MVP」**，附两个前置签字：① 只跑单实例（cron/限流/metrics/错误缓冲全在进程内，无锁无选主）；② 有人 SSH 确认 Hasee 跑的是**当前** main（§9.6 更正：报告通篇写的 `eff8ebe` 已过期，实测 `origin/main` = `9c5d764`）。**原第 ② 项里的「口令轮换」09-26 转为已接受风险，不再是签字条件** | 上一版判 🟡 的三条代码阻断已全部闭合（§9.1），第四条转为运维动作 |
| **对外商业 SaaS** | ❌ **不达标**（结论不变） | 阻断项仍是：告警只有生产端没有消费端、HTTPS/证书与 `NODE_ENV`、`/metrics` 收口、账号自助三缺、水平扩展方案、Stripe 真机 |

**仍未拍的产品决定**：D-1（音频空槽）。

（**订正**：上一版此处还写着「design-model-catalog ④ 未开工，需先拍『套餐可见性是否进数据面』」。④ 已于 2026-09-26 全部落地（`4c4e699`/`8266403`/`af9c6ed`：平台目录行 + 白名单合并、admin API + 门禁 + 审计 + 下架影响扫描、Settings 的目录维护界面）；而那个「待拍」的前提本身是错的——仓内**不存在**按套餐限制具体模型的机制（`PlanQuota` 只有 tokens/concurrentRuns/storageBytes/videoSegments/seats 五个维度，`packages/core/src/plans.ts:16-27`），所以 ④ 的数据面能表达的是「有哪些模型、什么模态、多少钱、开不开」，不含「谁能看见」。详见 [design-model-catalog.md](design-model-catalog.md) §十。）

### 9.6 §3④ 的处置改判（2026-09-26，用户决定）：**接受风险，不轮换**

上一版把「轮换那台机器的 sudo 口令」写成自托管口径的两个前置签字之一。**这条判错了口径**：那是一台**家庭内网的 staging 机**（`192.168.31.14`，见 §9.2 的探活命令），这条口令换到的是这台机器的 root，换不到任何外部账号、也不在任何云上。把它按「公开仓库凭据泄露」列成上线阻断，是我拿对外 SaaS 的尺子量自托管的机器。用户同日明确表示**不打算轮换**，并要求把它记成接受风险而不是待办。

**泄露面（2026-09-26 实测，不是推断）**

| 问题 | 结论 | 证据 |
| --- | --- | --- |
| 真值进过仓库吗 | 进过，两处命令示例 | 由 `2aa40b15` 引入（§3④），`7b003f6`（09-25 17:13 +08）替换为 `<pw>` |
| 现在公网还拿得到吗 | **拿得到，且不需要任何权限** | `git merge-base --is-ancestor 7fec506 origin/main` = YES（`7fec506` 是脱敏那条的父，仍带改写前文本）；`gh repo view` = `visibility: PUBLIC` |
| 改写 git 历史能拿掉吗 | **不能** | `git ls-remote origin 'refs/pull/*/head'` = **432 条**，GitHub 永久保留 PR head ref，force push 分支不会让它们失效；对象在 GC / 工单前仍可按 SHA 取。真要「新读者拿不到」只有一档：**换新仓库 + 归档或删除旧库** |
| 工作树还在新增暴露吗 | **不** | 当前三处命中全是占位符：`docs/production-ops.md` 两处 `<pw>`、本文件 §3④ 一处 `<口令>`、`design-monetization-m2-implementation.md` 一处 `<pw>`（`git grep` 实测） |

**这条决定的边界（写死，免得下次又被翻成阻断）**

* 接受的只有「**读过本公开仓库的人，可以拿到这台内网 staging 机的 root**」这一件事；
* 一旦下列任何一条成立，本决定**自动失效**、必须重判：这台机器改放别人的数据 / 开了公网入口 / 同一条口令在别处（尤其任何云上机器）复用 / 本仓库被 fork 到不可控处；
* 仓库若改 private、或删除换新，本条要重写（届时「公网可达」这个前提就不成立了）。

**顺带更正我自己写进本报告的两个数**

1. **远端状态一直是用没 fetch 过的 remote-tracking ref 报的**，所以「本地领先 N 个 commit」是假的。`git ls-remote` 实测：`origin/main` = `9c5d764`（不是本报告通篇写的 `eff8ebe`）、`origin/dev` = `1d894c8`、`origin/feature/20260824` = `90289b4`（= 本地 HEAD，**含本会话全部提交，已经在公网**）。有东西在自动 push，机制我没查——但 §9.2 那条「deploy 结论是 skipped、线上 commit 未证实」仍然独立成立、仍未闭合。
2. 会话中我曾报「12 个 commit 里 4 个仍带明文」——**作废**：那条正则 `echo [^ ]+ | sudo` 把占位符 `echo "<pw>" | sudo` 一起数了进去。真值具体散在哪些 commit，在本环境里**测不了**（逐 blob 检索被判为访问凭证而拦截），所以本表的口径只建立在已证的「父 commit 公开可达」上，不依赖那个数。
