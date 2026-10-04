# agent-world 项目级 MVP 评审（2026-09-25 更新版）

> 评审性质：项目级功能性 / 完整度 / 可上线性评审，硬标准 = **产品核心完全可用的 MVP**。
> 评审基线：2026-09-22 评审报告 + 本轮对代码/文档/CI 的一手核查。
> 评审环境：`feature/20260824 @ 7fec506`（本机未 push 部分见 §2）；~~Hasee 生产 = `main @ 0a4cbda`~~ —— **该口径 09-27 作废**（staging 按分支映射跟踪 `dev` 而非 `main`，见 §11.1）；**09-29 核验 staging 实际跑 `dev @ 779e926`，见 §12.6**。
> 前版：[mvp-readiness-review-2026-09-22.md](./mvp-readiness-review-2026-09-22.md) · [2026-09-21.md](./mvp-readiness-review-2026-09-21.md)
> **取证纪律**：本篇每一条结论都有本机命令输出或源码行号支撑；无法自证的（现网日志、真机走查、并行会话的口头结论）一律写进 §8 并标注证据等级，不参与判定。

---

## 1. 结论（先给判定）

| 口径 | 判定（09-25 当时） | 一句话理由 |
| --- | --- | --- |
| **个人 / 小团队自托管 MVP** | 🟡 **功能核心可用，但不签「完全可用 + 可直接上线」** | 主链六环真实存在、35/36 模板零配置可派发；但**终点环节有一处静默失败**（sink 空输入照样产出"成品"），另有 A/B 口绕过派发校验、远程 MCP 绕过自家 SSRF 闸、已跟踪文档里有一条明文服务器口令 |
| **对外商业 SaaS** | ❌ **不达标（比 09-22 版记录的更严格）** | 除既有的收款未真机 / 无 HTTPS 流程 / 单实例假设外，本轮新增：账号无密码找回与删除导出、订阅门禁默认关且新部署无声明、`/metrics` 无鉴权且进程绑全网卡、会话令牌服务端不可撤销 |

补齐 §3 的 ①②③④ 四条，我自认可以签「自托管核心完全可用 MVP」；这四条都是**小改动 + 已有同仓先例**，不是架构问题。

> ⚠️ **本表是 09-25 当时的判定，已被 [§9.5 追评（2026-09-26）](#9-追评2026-09-26-上午四个前置的复核结果与修订判定) 修订**：四条前置里的三条代码项已闭合、判定升为 ✅（附两个运维签字）。以 §9.5 为准，本节留作过程记录。**2026-09-27 复评见 [§10](#10-复评2026-09-27mvp-判定复核--修正)：sink/A/B/MCP 三阻断已确认闭合，自托管单机型 MVP 判 ✅、SaaS 仍 ❌。**

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

**零配置可用度（实测，非推算）**：临时探针把 36 个模板逐个 `instantiateTemplate → resolveModelSlots → validateModels`（`loadConfig(undefined)`，即只有内置 `DEFAULT_CONFIG`）——**35 可派发 / 1 被拒**，被拒的是 `tpl-news-podcast`，原因：其 `ttsModel` 字段默认值钉着 `tts-1`（`packages/core/src/templates.ts:1424`），而内置目录只有 text/image/video 模态（`packages/server/src/config.ts:312-319`），于是规则 A 生效后派发 422「模型「tts-1」已不可用」。这与该模板注释里写明的设计意图相反（无 TTS 能力时 `audioGen` **软跳过**、e5 旁路照样交付完整文稿，`templates.ts:1477-1481`）。→ 需决策（§7 决策 D-1）。

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
| **个人 / 小团队自托管** | ✅ **达到「产品核心完全可用的 MVP」**，附两个前置签字：① 只跑单实例（cron/限流/metrics/错误缓冲全在进程内，无锁无选主）；② ~~有人 SSH 确认 Hasee 跑的是**当前** main~~ —— **09-27 两处更正**：部署源是 **dev 不是 main**（`deploy.yml:6` 只看 `workflow_run` 上推入 dev 的事件，main 从不触发部署），且这一条已由 CI 一手日志闭合（`gh run view 36295873097` → `deploy OK: 403e71e`，而 `scripts/deploy/deploy.sh:27-40` 打这行的前提是 `git pull --ff-only` + 重启 + 轮询 `/api/health` 到 200）。**签字②因此撤销**，只剩①。**新增一条配置债**：Hasee 上 `NODE_ENV` 是否真的等于 `production` 无人证实，而全仓四处按生产走的行为（`WORKER=fake` 拒启 / metrics warn / sink warn / cookie `Secure`）都挂在这个字符串上——读法与后果见 [runbook 四之四](runbooks/deploy-ubuntu-server.md)。**原第 ② 项里的「口令轮换」09-26 转为已接受风险，不再是签字条件** | 上一版判 🟡 的三条代码阻断已全部闭合（§9.1），第四条转为运维动作 |
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

---

## 10. 复评（2026-09-27）：MVP 判定复核 + 修正

> 评审性质：对 09-25 版判定的一手复核（读源码 + 测试 + 三个并行 Explore 子代理分维度取证），硬标准不变 = **产品核心完全可用的 MVP**。
> 基线：`feature/20260824 @ 93a3fbe`（含本会话 D-1 落地 `6fc3b9d` + B 类决策登记，均待 push）；Hasee 生产 = `dev @ 3e010d92`（PR #437 合 dev，SSH 复核见 handoff 对账块）。
> 取证纪律同 §0/§8：每条结论有源码行号或测试输出支撑；子代理结论已逐一回验，不盲信。

### 10.1 判定（修正后）

| 口径 | 判定 | 一句话理由 |
| --- | --- | --- |
| **自托管单机型（信任 LAN / 单运营）** | ✅ **核心完全可用 MVP 达成** | 主链六环真实存在、35/36 模板零配置可派发、430+ 真实 staging run 佐证；§3 的 ①②③ 三处阻断已在 MVP 收尾批 #76 闭合 |
| **自托管暴露公网** | 🟡 **条件达成** | 需先收口 P1/P2 加固（`/metrics` 鉴权 / TLS / 默认错误 sink / git 历史口令轮换） |
| **对外商业 SaaS** | ❌ **不达标** | 真多租户 / 真收款 / Postgres HA 均未实施（已登记 deferred） |

### 10.2 对 §3 / §6 已失效项的修正（一手复验 2026-09-27）

- **§3① sink 空输入静默失败 → 已闭合**。`nodes/sink.ts:65` 加 `VALIDATION` 守卫（结构空 → `failed` + `VALIDATION` 且不归档；真断链仍 `failed`），`sink.test.ts` 3 测。→ `§6「成品不会静默为空」行应由 ❌ 改 ✅`。
- **§3② A/B 绕过 validateModels → 已闭合**。MVP 收尾批 #76 ② 在 `ab.ts:76` 调 `validateModels`，error 非空抛 `RunStartError(422)`。→ `§6「派发门禁覆盖」A/B 行应由 🟡/❌ 改 ✅`。
- **§3③ 远程 MCP 绕过 SSRF → 已闭合**。`mcp.ts` 四处裸 fetch（`:237/:306/:361/:378`）已换 `guardedFetch`（`#76 ③`），mcp 系 58/58 绿。→ `§6「服务端不外连内网」行应由 ❌ 改 ✅`。
- **§3④ 明文口令 → 维持接受风险**（用户 09-26 明确不轮换，§9.6）。仍记一笔：仓库公开 + 432 `refs/pull/*/head`，历史改写去不掉，对外暴露前必须轮换或转私有。

> 故 §1 的 🟡「功能核心可用但不签完全可用」以及 §6 的三处相关 ❌，以本条为最新准。

### 10.3 仍存的发布硬化项（仅影响「公网暴露」口径，不影响功能 MVP）

| P | 项 | 证据 | 状态 |
| --- | --- | --- | --- |
| P1 | `GET /metrics` 无鉴权（内部 run/error 指标暴露） | 原 `index.ts:327` 挂 root、鉴权中间件只罩 `/api/*`；**`84428f5` 之后**：`METRICS_TOKEN` 一设就要求 `Authorization: Bearer`（常量时间比较 + 401 带 `WWW-Authenticate`），另有 `BIND_HOST` 可把监听收回到指定网卡，生产未设 token 时启动 warn | **可收口，默认未收**（改默认会打断现有 LAN 直连部署 → 留成运维决定，登记在 deferred 安全/运维线） |
| P1 | 明文 sudo 口令在公开 git 历史 | §9.6 / production-ops §9.6 | 接受风险；暴露前必轮换 |
| P2 | 默认无外部错误 sink（Sentry 级 P0 缺口） | `index.ts:4435` 仅当 `ERROR_REPORT_WEBHOOK_URL` 才接 | **`b01e3e0` 起生产会在启动时说这件事**（`errorSinkStatus(env)` 纯函数 + 4 测）；接不接仍是运维决定 |
| P2 | Python code 节点 fs/net 隔离 best-effort（除非 bwrap） | `code-sandbox.ts:18-19,351-354` | Linux 强制 `CODE_SANDBOX=bwrap` |
| P2 | 限流进程内 / 单实例 | `rate-limit.ts` | 单机型无碍；多实例需共享 |
| P2 | 默认 nginx `:80` 无 TLS | deploy-ubuntu-server.md §5 | 暴露前加 TLS + `SECURE_COOKIES=1` |

### 10.4 一个诚实的口径更正：零配置 ≠ 出成品无需 key

09-25 版「零配置首跑」应精确为：**模型名解析 + 派发校验层面零配置**（35/36 模板 `loadConfig(undefined)` 可派发）；真正产出成品仍需运行时可用的 provider key。内置 `agnes` 读 `AGNES_API_KEY`（`config.ts:304`）——自托管运营者须自带 key（或 Settings 里加一个 OpenAI 兼容 provider）。这是自托管 AI 工具的常规 BYOK 预期，Settings 完全支持，**非产品缺陷**。**无任何核心模板依赖音频/TTS**——只有可选 `tpl-news-podcast` 因钉死 `tts-1` 被拒，且 09-27 已把该 422 文案改为「请到设置 → 集成接 TTS Provider」（D-1，见 handoff 决策块）。

### 10.5 SaaS 阻断项（明确 deferred，非 MVP 核心）

- 真多租户（`design-multitenancy.md` 未实施；当前仅 `user_id` 隔离）
- 真收款闭环（Stripe 代码完备，缺收款主体 + key，B4 推迟）
- Postgres HA（pg 驱动在，但 SQLite 为活跃路径，B4 推迟）
- 共享限流 / 生产级错误追踪告警（单实例现状）

### 10.6 结论

**自托管单机型 MVP ✅ 达成**：核心闭环完整、测试充分、430+ 真实 run 佐证，可签「核心完全可用」。信任 LAN / 单运营可立即上线；公网暴露前请先收口 §10.3 的 P1/P2（尤其 `/metrics` 鉴权 + TLS + 历史口令轮换）。**对外 SaaS MVP ❌**：多租户 / 收款 / Postgres HA 属架构前置，已正确推迟。

---

## 11. 第二次独立复评（2026-09-27，基线 `19a95f2`）

> **性质**：对 §10 的复核，不采信其结论。§10 自称「三个并行 Explore 子代理分维度取证」，而本仓对扫描来源有前科（§8：一次扫掠 5/5 头条结论被证伪），故本篇每一条都由我一手回代码或实跑取回。
> **基线**：`feature/20260824 @ 19a95f2`；`git ls-remote` 实测 `origin/feature/20260824` = 同一 SHA（**已 push**），`origin/main` = `4bc2dff`、`origin/dev` = `b3b9245`。
> **CI 事实**：`gh run list` 显示 `19a95f2` 的 push 运行 **conclusion=success**（build + `-r test` + typecheck + i18n 守护 + E2E + secret 扫描）。所以下表里本机的红都是**平台差异**，不是回归。

### 11.1 判定（我的口径，与 §10 对照）

| 口径 | 判定 | 与 §10 的差别 |
| --- | --- | --- |
| **自托管单机（信任 LAN / 单运营）** | ✅ **达到「产品核心完全可用的 MVP」** | 结论相同，依据换成我复验过的：主链六环逐环可指认 + **36 个模板里 35 个零配置可派发**（`grep -c '^  id: "tpl-' = 36`；`kind: "audioGen"` 全仓 1 处 = podcast，D-1 已定案）+ 失败路径不静默（规则 A `matched` 位、sink 二分、A/B 也进用量台账） |
| **自托管暴露公网** | 🟡 条件达成 | 条件**比 §10.3 多三条**（见 11.3） |
| **对外商业 SaaS** | ❌ 不达标 | 与 §10.5 一致，均为已登记的架构前置 |

### 11.2 对 §10 的四处修正（都是文档写错，不是代码写错）

1. **§10.2 把 sink 的语义写反了**。代码实际是：直接上游**全部**为不产正文的节点（branch/gate/媒体）→ 照常 `done` 且**不归档不发包**（`nodes/sink.ts:39-58`）；只要有任一内容型上游却拿到空 → `failed` + `VALIDATION`（`:59-67`）。§10.2 写成「结构空 → `failed` 且不归档 / 真断链仍 failed」，两半都错。这条正是 §3① 的收尾口径，读它的人会以为路由型产线在报错。
2. **§10.1 的「430+ 真实 run 佐证」要降级为历史佐证**：`handoff.md` #41 行明写 **09-25 起因内置 agnes free 配额耗尽已 0 run，2026-09-27 决策暂不处理**。所以那些 run 证明过链路能跑，但**不能证明「当下仍在跑」**，且本会话无法复测（内网 + 沙箱网络限制）。
3. **§10.3 漏了三条硬化项**（前两条 §9.4 登记过、这轮没人认领）：① `WORKER=fake` 仍是无护栏 env 开关（`providers/index.ts:94`），生产误设 = 整站假文本而 run 照样 `done`；② `build` 仍是纯 `tsc`（`packages/server/package.json:9`）→ dist 里 `.mjs` 计数为 **0**，于是声明 `isolation:"subprocess"` 的插件在部署态一律被拒——方向是**安全**的（`worker-plugins.ts:88-95` fail-closed + `log.error` + `available:false`，不是静默降级），但**CI 与 E2E 都不覆盖 dist 启动**（`playwright.config.ts:53` 的 webServer 是 `pnpm exec tsx src/index.ts`），所以这条门禁永远抓不到；③ ④ 的 `canManageModelCatalog` 是**死字段**：`index.ts:621` 算好下发，`apps/web` 全仓 **0 引用**（对照 `canManageAnnouncements` 被 `AnnouncementBell.tsx:41` 真用）。面板靠 403 自隐，功能不缺，但白打一次注定失败的请求，还把服务端已知结论在客户端重推一遍。**→ 本条已于同日收口**：`SessionUser` 补上这两个 flag，`ModelCatalogAdmin` 先读 `/me` 的答案、非管理员根本不发这次请求（`/me` 未回来时仍按旧路径走，403 → null 的自隐兜底保留，所以 flag 只可能藏界面、不可能开界面；新增 1 测并把护栏改成常量 false 验过它会红）。
4. **§10.3 的一处证据等级要标出来**：「Hasee 生产 = `dev @ 3e010d92`」是**转述**（另一会话的 SSH 对账），我未复测；而 §9.2 那条「针对某 commit 的 deploy 尝试结论是 `skipped`」在 §10 里没有对应处置，#60 仍应开着。

### 11.3 残余不一致（低优；我核过**不可达**，别当缺陷反复修）

音频路径留着两处硬编码兜底：`openai-compatible.ts:840`（`config.model || "tts-1"`）与 `nodes/audiogen.ts:21`（`?? { model: "tts-1" }`）——这是 #77 清零兜底后**唯一还在给模型名兜底的路径**。但它们在派发链上取不到控制权：`validateModels` 对「缺 config」和「模型名为空」都先给 `severity:"error"`（`validate-models.ts:34-49`），空串永远走不到 provider。所以这是**一致性欠账**（建议照 `requireModel()` 顺手收口，`openai-compatible.ts:52` 已有该助手），不是规则 A/B 的漏洞。`index.ts:2100` 的 `|| "agnes-2.0-flash"` 属「试连」路由对用户自填 baseUrl+key 的默认模型名，不在内置层。

### 11.4 门禁读数（2026-09-27 本机，逐包**单跑**）

| 包 | 读数 | 说明 |
| --- | --- | --- |
| core | 346/346（24 文件） | 绿 |
| server | 复评时 1433 → **本轮批次全部落地后 1448**（1444 过 / 2 跳过 / **2 红**，168 文件，load ≈10） | 那 2 红始终是 `engine.code.test.ts` 的 python 出网用例（本机 Xcode 许可 shim，Known issues）；CI 同 SHA 绿。增的 15 条是本会话的四组守护（`dist-assets` 4、`assertBootWorkerEnv` 3、`api.metrics` bearer 4、`errorSinkStatus` 4） |
| mcp-server | 71 = 70 过 / **1 红** → 降载复跑 **71/71 绿** | 那条红是 `stdio.test.ts` 的 5s 超时（load average 194→233 时跑的），**降载后复跑全绿**：负载抖动，不是回归。CI 同 SHA 也绿 |
| web | **第一次跑测条件不成立**：那次收集到 98 个文件 / 1755 条测（磁盘实有 **106** 文件），8 个文件没进收集，`20 failed` 分不清真失败还是超时 | **降载后复跑：106 文件 / 1978 条全绿**。同 SHA 的 CI `Typecheck, build & test` 亦 success。历史读数 09-26 为 1973/1973 |

**为什么本轮不报本机 web 数（这是判据，不是借口）**：那次跑收集到 **98** 个测试文件 / 1755 条测，而磁盘上实有 **106** 个测试文件——**8 个文件根本没进收集**，于是「20 条红」里无法区分真失败与 jsdom 超时。同期 `uptime` load average 在 **194→233** 之间（同机另有会话在跑构建）。**CI 在同一 SHA 上 `Typecheck, build & test` = success**（该 job 含 web 套件），所以本篇对 web 的判断挂在 CI 与 09-26 低负载本机读数上，不假装本机复现过。

**降载后复跑（同日）——上面那段作废为历史记录**：load average 降到 16 时重跑 web：**106 文件 / 1978 条全绿**。所以留下的不是「那 20 条是假红」，而是一条可操作的规矩——**本机报红之前，先看 load，再比「收集到的文件数」是否等于「磁盘上的文件数」**；任一项对不上，这次跑就不构成证据。不依赖本机状态的那一条始终在：同 SHA 的 CI `Typecheck, build & test` = success。

**一条方法学结论，顺带回答 §8 遗留问题 3**：`pnpm -r --if-present test -- --maxWorkers=1` 里的参数确实到达 vitest（否则它会被当文件名过滤、一个测试都不跑），但 **`pnpm -r` 本身是包间并发的**——CI 串行的是包内 worker，不是四个包。本机在高负载下把四包串跑（或不串跑）都会把负载抖动读成回归：**报红之前先看 load，再看收集到的文件数是否等于磁盘上的文件数**。

**签字②撤消后重新量的四包读数（同日，开账号批次落地后，load ≈8，四包同批实跑）**：core **346/346**（24 文件）· server **1460**（169 文件 = 1456 passed / 2 skipped / **仍是同样那 2 条 `engine.code.test.ts` 的 python 出网用例**，本机 Xcode CLT shim，Known issues）· web **1996/1996**（107 文件）· mcp **71/71**（3 文件）。合计 **3873 / 303 文件**（3848 → 3873，本会话 +25：server 12、web 13）。**红条集合与上一批逐条相同**，这是「环境基线而非回归」的第二次独立证据（两批负载条件不同，红的是同一对 python 用例）。

### 11.5 本轮没有推翻 MVP 判定的新缺陷；推翻的是四处文档表述

主链、派发校验、目录数据面、成本台账四条我都能逐行指认；三处硬化项（`WORKER=fake` / dist 缺 `.mjs` / 死字段）都是**小改动 + 已有同仓先例**，不构成阻断。公网暴露口径下，P1 仍必须先收 `/metrics` 鉴权与 TLS。

> **同日追记（本会话内闭合）**：上面那三条都做了——`3df542a`（`assertBootWorkerEnv`：生产 + `WORKER=fake` 启动即抛，其它环境 warn；守护 3 例，植入空操作护栏验过会红）、`02f0e67`（build 追加 `cp src/*.mjs dist/` + `src/dist-assets.test.ts` 四条守护，含**真起一次 dist 进程打 `/api/health`**；藏掉一个 dist 文件验过会红）、`69e26b8`（`SessionUser` 补 capability flag，面板改读 `/me` 的答案、非管理员不再发那次注定 403 的请求）；两条升级须知落在 `d3c58cd`（runbook「四之三」+ `.env.example`）。**同日又补两条**：`84428f5`（`METRICS_TOKEN` 让 `/metrics` 要求 bearer、`BIND_HOST` 可收回监听网卡、生产未设 token 时启动 warn——**默认一律不变**，因为改默认会打断现有 LAN 直连部署）、`b01e3e0`（`errorSinkStatus(env)` 纯函数 + 4 测：生产没设 `ERROR_REPORT_WEBHOOK_URL` 就在启动时说清楚「崩溃记录随进程消失」）。**§11.2 第 3 条因此从「§10.3 漏列」变成「已闭合」**，留在原地是为了记下它是被一次复评才发现的；`/metrics` 与错误 sink 两行的现状改记在 §10.3 表内（可收口 ≠ 已收口，收口与否是运维决定）。仍未闭合的是 §11.2 第 4 条（线上跑哪个 commit 需人 SSH 确认）与 P1 的 `/metrics` / TLS。

---

## 12. 第三次独立复评（2026-09-27 夜，基线 `45ab9cb`）

> **性质**：对 §10/§11 判定的再一次独立复验（源码一手取证 + 四包实跑），不采信其结论，且基线比 §11 更靠后——含「开账号批次」（`b99519c`/`49be041`/`c92603f`/`45ab9cb`）。
> **环境**：本机 fnm 默认已切到 Node **v20.20.2**，与仓库硬要求冲突（依赖 `node:sqlite` 与 undici@8）。本节所有读数均在 **Node 24.20.0** 下取得：把 `…/fnm/node-versions/v24.20.0/installation/bin` 前置 PATH，并直调各包 `node_modules/.bin/vitest`，**绕开 pnpm 的 node 重解析**（否则 pnpm 子进程会回落 v20）。

### 12.1 判定（与 §11.1 一致，未变）

| 口径 | 判定 |
| --- | --- |
| **自托管单机（信任 LAN / 单运营）** | ✅ **达到「产品核心完全可用的 MVP」** |
| **自托管暴露公网** | 🟡 条件达成（缺口是**运维动作**，非代码能力） |
| **对外商业 SaaS** | ❌ 不达标（多租户 / 收款 / PG HA 属架构前置，已登记 deferred） |

### 12.2 我一手复验的 MVP 关键项（逐条通过）

- **终点不静默**：sink 空输入守卫——结构性空（上游全是 branch/gate/媒体）→ `done` 且不归档；内容型上游却为空 → `failed` + `VALIDATION`（`nodes/sink.ts:28-76`）。
- **派发门禁覆盖 A/B**：`ab.ts:76-83` 调 `validateModels`，error 非空抛 `RunStartError(422)`。
- **服务端不外连内网**：`mcp.ts` 四处 fetch 全换 `guardedFetch`（`:238/:307/:362/:379`）。
- **节点全覆盖**：`NodeKind` 29 种；`NODE_HANDLERS` 28 项 + `notify` 内联 = 全覆盖（`engine.ts:151-180`），`nodes/` 28 个 handler 文件。
- **模板**：`grep -c '^  id: "tpl-'` = **36**。
- **生产拒假 worker**：`providers/index.ts:46-55` `assertBootWorkerEnv`（生产 + `WORKER=fake` 启动即抛）。
- **部署产物完整**：`packages/server/package.json:9` build 含 `cp src/*.mjs dist/`。

### 12.3 门禁读数（2026-09-27 夜，Node 24.20.0，逐包隔离实跑）

| 包 | 读数 |
| --- | --- |
| core | **346/346**（24 文件） |
| server | **1460** = 1410 过 / **2 红** / 48 跳过（169 文件） |
| mcp-server | **71/71**（3 文件） |
| web | **1996/1996**（107 文件） |
| 合计 | **3873**，与 handoff / §11.4 快照一致 |
| typecheck | 四包全绿 |

- server 那 2 条红已定位到 `engine.code.test.ts` 的 python 出网两条用例（本机 `python3` 为 Xcode CLT 许可 shim）；单跑该文件复现同样 2 条，与 Known issues 基线一致，**非回归**。
- **web 串跑会误报**：四包连续跑时首跑出现 6 文件 / 7 测红；**隔离单跑 107 文件 1996 全绿**（load≈345 下亦然）。印证 handoff「报红前先隔离重跑、先看 load」的判据。

### 12.4 两条非阻断的完整度欠账（不影响 MVP 判定）

1. **`db.ts` 抽象层有两处内部旁路**：`memory.ts`（FTS5 建表/触发器 + CRUD）与 `key-rotation.ts:179`（`UPDATE`）直接走 driver 的 `prepare`/裸 SQL，未收敛进 `db.ts`；违反「DB 访问统一走 `db.ts`」约定，**迁 PG 时需逐处返工**。`connectors.ts:280` 是用户 SQL 连接器，属设计内，不计。
2. **本机 Node 默认版本陷阱**：fnm 默认已是 v20 后，直接 `pnpm test` 会因 `node:sqlite`/undici 大面积报红；须 `fnm exec --using=24`（handoff 已记，但默认值变更后更易踩）。

### 12.5 结论

**未发现任何推翻 §11.1 判定的新缺陷。** 自托管单机型 **✅ 达到「产品核心完全可用的 MVP」**；对外商业 SaaS **❌ 不达标**；公网暴露前逐项过 [public-exposure-hardening.md](runbooks/public-exposure-hardening.md) 那份闸门（TLS + `SECURE_COOKIES` 的先后、`/metrics` 收口、错误 sink 的消费端、设 `NODE_ENV=production` 之前先查 `WORKER=fake`）。

**订正本节上一版的一处口径**：这里原写「仍须先收 §10.3 的 P1（… + **历史口令轮换**）」——把一件**已结案**的事当阻断项复述了。那台 staging 机的 sudo 口令 09-26 由用户决策转为**已接受风险**（§9.6：不轮换、不改写历史；且改写历史也拿不掉，因为脱敏那条的父 commit 至今可达、远端还有 432 条 `refs/pull/*/head`），所以它不在暴露前的闸门里，只挂在 §9.6 的四条失效条件上。这句话是照抄 §10.3 的旧清单留下的，凡与之冲突以 §9.6 为准。

## 13. 部署核验追记（2026-09-29）

> **性质**：不是新一次评审，只补一条 §11.1/§12 都留着的运维尾巴——「线上到底跑在哪个 commit」。判定不变，仍是 §12.1 那张表。

**结论**：staging 已部署 **`779e926`**，且这正是当前 `origin/dev` HEAD——即 `feature/20260824` 的全部工作**已上线**。

**取证（三条，均本机可复现）**：

1. **部署源确为 dev**：触发部署的 CI 是 dev 上的 push run（run `36447349306`，`event=push` / `headBranch=dev` / `headSha=779e926`，2026-09-28T15:56:15Z，success），符合 `deploy.yml:7/15` 的 `branches:["dev"]` + `event=='push'` 双闸门。
2. **health 200 读数**：Deploy run `36447733305`（2026-09-28T15:59:24Z，1m28s，success）日志在四包 build 全 Done 后以 `deploy OK: 779e926` 收尾。`scripts/deploy/deploy.sh:39-43` 只在 `/api/health` 轮询拿到 200 时打印该行，失败则打 `deploy FAILED` 并 `exit 1`——**故这一行本身即一次健康读数**，是 §11.1 那条「CI 一手日志闭合」手法在本次基线下的重放。
3. **内容闭合**：`779e926` = 「Merge pull request #454 from bayernjf/feature/20260824」；`git merge-base --is-ancestor 11b8eab 779e926` = **YES**。逐条查过本报告与各设计文档引用的 SHA（`978ab56`/`36135e8`/`2fbcbe1`/`33dcc91`/`1ea3c62`/`0a1ec39`/`93b3082`/`0cbf11e`/`2c8bc22`/`66d337f`/`34b1aed`/`b99519c`/`49be041`/`c92603f`/`45ab9cb`/`7fec506`）**全部是 `779e926` 的祖先**，即这些文档里写于当时的「未 push / 未合 dev / 尚未 push」现已一律作废。

**一条给后来者的判据更正（本轮踩到）**：**不要用 Deploy run 自己的 `headBranch`/`headSha` 判断部署内容**——`36447733305` 这两个字段报的是 `main` / `bfc74ce`，既不是被部署的 SHA 也不是 dev ref（`workflow_run` 事件的字段天生如此）。有效信号只有两个：dev push CI 的 `headSha`，与部署脚本自报的 `deploy OK: <sha>`。

**边界（如实记，不参与判定）**：本轮**未**本机 SSH 打 `/api/health`——staging 主机在局域网内，当前网络 `No route to host` 且无 Tailscale。上述健康读数是**部署脚本自带的闸门**，不是本机直连读数。要拿第一手读数须在能路由到该网段的机器上 `curl -s http://127.0.0.1:8791/api/health`。这与 §2 记的取证纪律一致：够不到的证据标出来，不当成拿到了。

**旁证**：`origin/main` 现为 `e1628016`（「Merge pull request #455 from bayernjf/dev」，父提交 `bfc74ce` + `779e926`），即 dev 已回灌 main；main 比已部署版本多一个 merge，但 **main 不在部署轨道上**（§11.1），不影响上线判定。

## 14. 第四次上线复核（2026-10-04，基线 `96b969b`，本机一手读数）

> **结论先说**：**判定不变**——自托管 ✅ 达到「产品核心完全可用的 MVP」；对外商业 SaaS ❌ 仍不达标（收款主体 / HTTPS+域名 / provider 真灾备 / PG HA / Sentry 这五件一件没变）。变的是 §12 那个「唯一运维签字」：**它两半里的一半已经用实测闭合，另一半缩成一行 grep**；同时实测出**两条新的生产配置缺口**，它们不是功能阻断，但决定了「能上线」与「能给第二个人用」是两件事。

**① §12 签字的两半，现在的实测状态**
- **只跑单实例：✅ 已闭合**（一手）。`ps` 里 `dist/index.js` 恰好 1 个进程（PID 58950）、`:8791` 只有 1 个监听 socket；上一手同口径读数是 09-26 的 PID 710。
- **`NODE_ENV` 到底设没设：剩一行**。实测 `systemctl show -p Environment,EnvironmentFiles agent-world`（**不需要 sudo**，正控制是同一条读数里 `DB_FILE`/`CODE_SANDBOX` 都在）——其中**没有 `NODE_ENV`、没有 `AGENT_WORLD_ENV`**，也没有 `SECURE_COOKIES`/`WORKER`。于是 `/api/health` 报的 `env:"staging"` 只可能来自 `/opt/agent-world/.env`（`index.ts:14` 先 `import "./load-env.js"`）。要签的只剩 `sudo grep -nE '^(NODE_ENV|AGENT_WORLD_ENV|SECURE_COOKIES)=' /opt/agent-world/.env` 这一行。
- 顺带把本轮发现自己写错的一处推理改掉：`env` 字段是回退链，**「报 staging」推不出「`AGENT_WORLD_ENV=staging`」这一具体写法**（详见 [deploy-ubuntu-server.md 四之四](runbooks/deploy-ubuntu-server.md)）。运维结论不变：`=== "production"` 的四条闸在这台机器上全休眠。

**② 新实测出的两条生产配置缺口（都要 root 才能收）**
- **`/metrics` 对整条局域网开放、无鉴权**。从本机 `curl http://192.168.31.14:8791/metrics` 得 **HTTP 200 / 27 行**，读得到 `runs_total`、`runs_failed_total`、**`runs_cost_usd_total`**、`runs_active`、`http_requests_total`。旋钮早就在（`METRICS_TOKEN` / `BIND_HOST=127.0.0.1`），默认刻意没改（改默认会打断所有从局域网直连 :8791 的既有部署）。⇒ **判定**：只在信任的局域网自托管时可接受；一旦有第二个人或出公网，这是暴露前必收项（[public-exposure-hardening.md](runbooks/public-exposure-hardening.md) §2/§3 已列）。
- **错误 sink 至今没有消费端**：同一条 env 读数里**没有 `ERROR_REPORT_WEBHOOK_URL`**。#86 已把接 relay 的全链路验完（204/500/不可达三态实测），差的是一行 drop-in 注入。
- **两条的耦合正是本仓一直在治的静默类**：这两处「生产才 warn」都因 `NODE_ENV≠production` 而**一句都不打**——所以它们不是被发现了，是被读 env 顺手读出来的。反过来说：谁把 `NODE_ENV=production` 设上，日志会立刻同时冒出这两句，且 cookie 会开始带 `Secure`（局域网 http 登录会掉 cookie，处置见四之四那三条路）。

**③ 审计侧同日进展**：[code-audit-2026-09-30.md §七](code-audit-2026-09-30.md) 补出的 8 条里 **6 条同日修完**（含两条高危中的 7.1；7.2 让 PG 轨第一次有了会被 CI 执行到的 owner 约束），7.7 是门禁取向、7.8 要 root。**副作用如实记**：deploy.yml 认 CI 总结论，新 postgres job 从此在部署闸门里。

**④ 证据等级（本轮）**：**一手执行**＝`/api/health` 直连、`ps`/`ss` 单实例、`systemctl show` env 读数、`/metrics` 200 读数、真 `postgres:16` 容器上的 owner 复现与修复验证、CI run 37212932643/37213336439 的 job 结论与 `deploy OK: 96b969b`。**未做**＝没有在带 root 的机器上读 `.env`（所以 ① 那一行仍未签）、没读生产 `prune-demo.log` 确认 7.4 守卫在新默认下放行（runbook 那条 cron 显式带 `DB_FILE`，推理上成立，未实测）。
