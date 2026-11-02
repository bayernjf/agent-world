# 深度代码评审报告（2026-11-02）

> 评审时间：2026-11-02。范围：monorepo 全 4 包（`packages/core`、`packages/server`、`packages/mcp-server`、`apps/web`）+ 根目录运维/部署配置。
> 性质：**只读深度评审**（未改任何源码、未提交）；唯一新增文件即本报告。
> 基线 commit：`0c2c534 fix(web): raise ink-faint for dark-theme AA`（工作区干净）。
> 方法：九维度静态审查（架构/正确性/安全/数据模型/错误处理/测试/依赖/性能/文档一致性）+ **全部验证门实跑**（Node v24.22.2 via fnm、pnpm 10.12.1 via corepack）；历史审计（security-audit-2026-08-31 的 3 条 Critical、code-audit-2026-09-30 §七 的 2 条高危）逐条复核现状。
> 规模基线（实测）：git 跟踪 **846 文件**；TS/TSX 合计 **143,919 行**（含测试）；测试文件 **315 个**；server 包 src 260 个文件；迁移 **42 个连续版本**。

---

## 一、仓库定位与规模概览

自托管优先的 Agent 工作流画布平台：画布拖拽编排节点（29 种 NodeKind），引擎事件溯源执行，SSE 实时流回前端；计费/订阅（Stripe）、RBAC 共享、静态加密、审计日志、MCP 对外暴露均已落地。

| 模块 | 技术 | 职责边界 |
|---|---|---|
| `apps/web` | React 19 + Vite 8 + zustand + i18next + three.js（懒加载） | 画布/检查器/运营台，同源 cookie 认证，DOMPurify 渲染模型输出 |
| `packages/core` | zod 4 | 图/模板/技能 schema 单一事实源，NodeId 字符集约束（graph.ts:1011） |
| `packages/server` | Hono + node:sqlite（`DatabaseSync`）/ PG 双驱 | API 134+ 端点、引擎、沙箱、SSRF 闸、加密环、Stripe 镜像 |
| `packages/mcp-server` | MCP SDK | 对外只读档暴露，Origin + Bearer 双闸（http.ts:87-114） |

数据访问统一走 `db.ts` 抽象（SQLite/PG 双驱，`pg-sql.ts` 用字符级 tokenizer 翻译 `?`→`$n`，非裸正则），SQL 方言集中在驱动层——与 AGENTS.md「禁止裸 SQL 方言」约定一致，全仓 grep 未发现面向用户输入的 SQL 拼接（标识符插值仅出现在迁移/运维脚本的内部常量表名上）。

## 二、结论摘要

**P0：0 条｜P1：1 条｜P2：3 条｜P3：7 条**

总体判断：安全纵深与测试门禁在本量级项目中属于上游水平——历史 3 条 Critical（密钥外泄/任意文件写/SSRF 重定向）与 §七 2 条高危（PG owner 单例、rotate-reencrypt fail-open）**均已修复并有对应守护测试**；本次实跑全部验证门绿灯（详见 §四）。没有发现新的可利用安全缺口或数据丢失路径。

Top 3 发现：

1. **P1 `.dockerignore` 未排除密钥文件**——`Dockerfile:20` 构建阶段 `COPY . .` 会把仓库根的 `.env`（含 `AGNES_API_KEY`）、`.jwt-secret`、`.encryption-keys` 烘进中间镜像层与本地 build 缓存（最终 runtime 镜像干净，但缓存可导出/可读取）。
2. **P2 迁移前自动备份失败被完全静默吞掉**——`sqlite-backup.ts:37` 空 `catch {}`：这是迁移炸库前唯一的安全网，失败不落任何日志，操作者会在最需要快照时发现它从未成功。
3. **P2 web 主 bundle 834 kB（min）/ 217 kB（gzip）**——构建有 >500 kB 警告；three.js 已懒加载隔离但主包无 vendor 拆分，首屏成本随功能增长单调上升。

## 三、逐条发现

### P0（可利用安全 / 数据丢失 / 停摆）

无。

历史 P0 级复核（均确认已修复，附证据）：

- ~~C1 `/api/providers/test` 运营商密钥外泄~~：`routes/settings.ts:309` 强制「已保存密钥仅可发往已保存 baseUrl」（same-source 校验），且有 `settings.test_provider` 审计。
- ~~C2 节点 id 路径穿越任意文件写~~：`core/src/graph.ts:1011` NodeId 正则 `^[A-Za-z0-9]+[A-Za-z0-9._-]*$` + `storage.ts:47-53` 每次存取 `resolve` 后强制 base 包含校验（双重防御）。
- ~~C3 HTTP 节点 SSRF 重定向绕过~~：`nodes/http.ts:97` 统一走 `guardedFetch`，DNS 解析钉连、手动逐跳重定向复检（`ssrf.ts`，含 IPv4-mapped IPv6、NAT64、Teredo 规范化）。
- ~~§七-7.2 PG 库 owner 单例无约束~~：`pg-smoke.test.ts:93/121` 断言 `idx_users_owner` 在 PG 路径存在，CI 有独立 postgres job 真跑该测试。

### P1（严重）

**P1-1 `.dockerignore` 未排除本地密钥，构建期进入中间镜像层**

- 位置：`.dockerignore`（全文仅 10 行：node_modules / dist / .git / .gitignore / *.sqlite / *.log / .DS_Store / coverage）；`Dockerfile:20` `COPY . .`（build 阶段）；`load-env.ts:28`（服务启动读仓库根 `.env`）。
- 影响：按 README/docker-compose 路径自托管的用户，其仓库根 `.env`（`AGNES_API_KEY`、`DB_FILE`）、`.jwt-secret`、`.encryption-keys`、`agent-world.config.json`、`artifacts/`、`logs/` 会被复制进 build 阶段镜像层。最终 runtime 阶段只拷 dist（Dockerfile:27-33，干净），但中间层留在本机 docker 缓存；若使用 buildx 导出缓存或共享构建机，密钥随之扩散。`.gitignore` 已正确忽略这些文件，`.dockerignore` 未对齐。
- 修复建议：`.dockerignore` 增加 `.env`、`.env.*`（保留 `!.env.example`）、`.jwt-secret`、`.encryption-key*`、`agent-world.config.json`、`artifacts/`、`logs/`、`backups/`、`handoff.md`。

### P2（质量 / 性能 / 失败模式）

**P2-1 迁移前快照备份失败零日志**

- 位置：`packages/server/src/sqlite-backup.ts:37-39`——`catch {}` 空块，注释「Backup failures must never block startup」。
- 影响：`VACUUM INTO` 失败（磁盘满、权限、WAL 异常）时启动照常、迁移照跑，但 `backups/` 没有新快照且无一行日志。该备份是「迁移把库改炸」前唯一的回滚来源（retention=5），静默失效把「安全网」变成「心理安慰」。同类设计对比：`at-rest.ts` 解密失败是 fail-closed 抛错的，这里选择了对称的反面却不留痕迹。
- 修复建议：catch 内加 `log.warn("pre-migration backup failed", { error: errMsg(err) })`；保留不阻断启动的行为即可。

**P2-2 web 主 chunk 834 kB，无 vendor 拆分**

- 位置：`pnpm -r build` 实测输出：`dist/assets/index-CHwzrL1k.js 833.89 kB │ gzip: 217.41 kB`，构建器 rolldown 警告「Some chunks are larger than 500 kB」。`apps/web/vite.config.ts` 无 `manualChunks`/`codeSplitting` 配置（grep 无命中）。
- 影响：three.js 已正确隔离（`App.tsx:77` `lazy(() => import("./canvas/Canvas3D"))`，iso3d 445 kB / OrbitControls 607 kB 为独立懒加载 chunk），但 React 19 + i18next + DOMPurify + 全量应用代码都在首屏主包。对自托管内网场景影响有限，但公网/弱网首屏可感知，且随功能单调增长。
- 修复建议：按构建器提示用 `build.rolldownOptions.output.codeSplitting` 拆 `react`/i18next vendor chunk；或评估 `chunkSizeWarningLimit` 之前先确认拆包收益。

**P2-3 git 依赖 `@model-hub/model-kit` 游离在供应链门禁之外**

- 位置：`packages/server/package.json:25` `"@model-hub/model-kit": "git+https://github.com/bayernjf/model-hub.git#v0.1.1&path:/packages/model-kit"`。
- 影响：`pnpm audit` 与 Dependabot 均不覆盖 git 依赖的 CVE/版本演进；模型路由的关键路径组件，其更新完全靠人工记忆。CI 里还需要 `git config url.insteadOf` 把 ssh 映射 https 才能装（ci.yml 注释），属脆弱点。风险等级中等——个人仓库、tag pin 到 `v0.1.1`，但无法证明 tag 不被 force-push 移动。
- 修复建议：锁定到 commit SHA（`#<sha>`）替代 tag；中期发 npm 私有包或 vendored submodule。

### P3（约定 / 文档一致性 / 卫生）

1. **`.env.example` 与代码实际读取的环境变量脱节**：代码读取但示例未列——`DB_DRIVER`、`DATABASE_URL`（PG 是已落地的主打特性，`db.ts:45-58`）、`TRUSTED_PROXY_IPS`（安全相关，`routes/shared.ts:90`）、`DEMO_RATE_LIMIT`、`HALTED_RUN_TTL_DAYS`、`AGENT_WORLD_SHUTDOWN_GRACE_MS`、`AGENT_WORLD_RPA_STATE_DIR`（grep 全仓核对，示例文件 0 命中）。建议补齐或注明「完整清单见 production-ops.md」。
2. **dependabot.yml 的 zod 注释已过期**：`.github/dependabot.yml:21-24` 仍写「Keep zod on 3.x until that migration is scheduled」，但 core/server 均已用 `zod ^4.6.7`（迁移已完成），ignore 规则本身可保留，注释应更新。
3. **`BENCHMARK.md` 整体为占位**：How to run / Known limits 均为 TODO，结果表空。要么补最小基线（引擎吞吐/事件写入），要么降级为 deferred-items 一行。
4. **仓库根残留运行期产物**：`agent-world.sqlite` + `-wal`（914 KB）+ `-shm`、`.env`、`.jwt-secret`、`.encryption-keys`、`eng.traineddata`（5 MB）均存在于工作树根（已确认**未被 git 跟踪**：`git ls-files` 无命中，`check-ignore` 全部命中 `.gitignore` 规则）。卫生层面建议 `DB_FILE` 默认指向 `data/` 子目录，降低 `git add -f` 误伤与 IDE 索引噪音。
5. **注册接口可枚举已注册邮箱**：`routes/auth.ts:43` 返回 409「该邮箱已注册」。自托管 + 默认关注册的场景下影响可忽略；若未来开放公网注册需改统一口径。登录侧已是统一的 `invalid_credentials`（auth.ts:69/83），口径正确。
6. **会话无吊销机制**：logout 仅清 cookie（`routes/auth.ts:93-102`），JWT 在到期前（最长 7 天，`auth.ts:31`）持续有效；改密不吊销旧会话。文档已如实披露（runbooks/mcp-client-access：「撤销不了」），属已知接受风险，公网开放前应排期。
7. **`@types/pg` 放在 dependencies**：`packages/server/package.json:26`，应为 devDependencies（`pg` 自带运行时，类型只用于编译）。无实际危害。

### 已核实无问题（抽样，防误报）

- 认证全链路：bcrypt(cost 12)、jose HS256 + issuer 校验、secret 文件 0600 持久化、cookie `HttpOnly; SameSite=Lax` + 生产 Secure、`must_change_password` 强制、登录/注册/demo 三档 IP 限流（`routes/shared.ts:102-120`）。
- CORS：`CORS_ORIGINS="*"` 启动即拒（`security.ts:18-22`）；`/metrics` 支持 Bearer 且生产未设时 boot 告警（index.ts:212-216）。
- Stripe webhook：`constructEvent` 验签（stripe.ts:244）+ claim-first 幂等 + 15min 僵死认领窃取（stripeWebhook.ts:342-366）。
- 前端 XSS 面：全仓仅 1 处 `dangerouslySetInnerHTML`（测试文件）；模型输出渲染统一过 `sanitize-html.ts`（DOMPurify）+ `sanitizeUrl`；图片代理强制非可执行 content-type（index.ts:839-841）。
- 密钥泄漏扫描：全仓 grep `sk_live/whsec/service_role/AKIA/PEM` 仅命中文档与测试夹具；gitleaks 在 CI 独立 job。
- 幂等：POST /api/runs 与 Stripe webhook 均为 claim-first（runs.ts:255-272），审计 7.6 的并发窗口已闭。
- SSE：`/stream` 的 `?token=` 仅限 stream 路径（index.ts:467），请求日志不落 query；事件 DB 先写后推内存，`seq > cursor` 去重正确。
- 迁移机制：42 个连续版本、`BEGIN/COMMIT` 事务、baseline detect、无 `down` 的数据迁移拒绝回滚而非瞎猜（sqlite-schema.ts:1309-1358）；fresh 库实跑验证 boot 正常。

## 四、验证门实际执行结果

环境：macOS（Darwin arm64）、Node **v24.22.2**（fnm 切换；系统默认 v22 不满足 `engines: ">=24.0.0"`）、pnpm **10.12.1**（corepack）。依赖已就位（未重新安装）。

| 门禁 | 命令 | 结果 | 实测输出 |
|---|---|---|---|
| Lint | `pnpm lint`（biome） | ✅ 通过 | `Checked 736 files in 2s. Found 72 warnings. Found 1 info.` **0 error**（error 级仅 `noUnusedVariables`+`useHookAtTopLevel`，与 biome.json 一致；72 条 warn 几乎全是 `useExhaustiveDependencies`，配置本身即 warn 不 gate） |
| 类型检查 | `pnpm typecheck` | ✅ 通过 | core/web/mcp-server/server 四包 `Done` + 根 `tsconfig.scripts.json` 通过 |
| 单测 core | `pnpm --filter @agent-world/core test` | ✅ **351/351**（25 文件） | — |
| 单测 mcp | `pnpm --filter @agent-world/mcp-server test` | ✅ **71/71**（3 文件） | — |
| 单测 web | `pnpm --filter @agent-world/web test` | ✅ **2044/2044**（111 文件） | — |
| 单测 server | `pnpm --filter @agent-world/server test` | ✅ **1530 passed / 5 skipped / 0 failed**（176 文件，173.7s） | 跳过均为门控：`pg-smoke`×3（需 PG 服务）、`dogfood-templates`×2（DOGFOOD=1）；handoff 记录的 2 条 Xcode python shim 红**未复现**（本机 python3 3.9.6 可用） |
| 构建 | `pnpm -r build` | ✅ 通过（4 包） | web 有 >500 kB chunk 警告（见 P2-2），无错误 |
| i18n 守护 | `i18n:check` + `i18n:prune -- --check` | ✅ 通过 | `no value-level drift`；`total unreferenced: 0` |
| 依赖审计 | `pnpm audit --audit-level=high` | ✅ 0 high/critical | 全量 3 条 moderate（minimatch<11.0.1、glob≤14.0.1，均位于 dev-only 的 `i18next-parser` 依赖链） |
| E2E | `pnpm e2e` | ✅ **5/5 通过（46.4s）** | ⚠️ 默认端口失败一次：`8792` 被外来进程占用（`node --experimental-sqlite dist/server.js` PID 51509，**非本仓产物**，未擅杀）；改用 `E2E_SERVER_PORT=8892 E2E_WEB_PORT=5274` 后全绿。该失败属环境串扰，非仓库缺陷；但说明 E2E 端口冲突时的报错（`Process from config.webServer exited early`）定位成本高，可考虑在 playwright.config.ts 加端口占用前置检查 |

**实测总测试数：3996 passed + 5 skipped + 5 E2E passed**（README 写的 3891、handoff 写的 3873/3938 为各自日期快照，正常漂移）。

## 五、修复优先级建议

| 序 | 事项 | 级别 | 工作量 |
|---|---|---|---|
| 1 | `.dockerignore` 补齐密钥/产物排除项（P1-1） | P1 | 5 分钟，一行组 |
| 2 | `sqlite-backup.ts` catch 加 `log.warn`（P2-1） | P2 | 5 分钟 |
| 3 | model-kit git 依赖 pin 到 commit SHA（P2-3） | P2 | 10 分钟 + lockfile |
| 4 | `.env.example` 补 `DB_DRIVER`/`DATABASE_URL`/`TRUSTED_PROXY_IPS` 等（P3-1） | P3 | 半小时 |
| 5 | web vendor 拆包评估（P2-2） | P2 | 半天（需回归验证懒加载边界） |
| 6 | dependabot zod 注释、BENCHMARK.md 占位清理（P3-2/3） | P3 | 顺手 |
| 7 | 会话吊销 / 注册枚举口径 —— 排期到「公网开放注册」前置项（P3-5/6） | P3 | 随触发条件 |

按 AGENTS.md「新增文档后补索引」的约定，本报告路径建议登记到 `handoff.md`「Project documents」区与 `docs/README.md` 文档地图（本次评审为只读，未代为改动）。
