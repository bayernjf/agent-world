# RPA 回读真实环境接入清单

> 目的：把 F6/F7-C 的 RPA 只读回读从「框架骨架」变成「可用的平台适配器」。
> 框架已落地（`packages/server/src/rpa/`，commit `c0c4aa9`），缺的只是真实平台的登录流程与数据 DOM 选择器——本清单就是「拿到真实环境后要逆向什么、怎么填」的操作手册。
> 关联：[design-ecommerce-roadmap.md §F6 合规采集策略 / §F7-C 技术选型](design-ecommerce-roadmap.md)

---

## 0. 前置条件

| 项 | 要求 | 说明 |
|---|---|---|
| 账号 | 一个真实平台账号 | **强烈建议用测试号/小号**，避免封号风险波及主号 |
| 环境 | 有图形界面（GUI） | headful 模式 + 扫码登录都需要窗口，纯 headless 服务器无法扫码 |
| 工具 | 浏览器 DevTools | F12 逆向 DOM 选择器 |
| 依赖 | `playwright` + chromium | 已装（`pnpm --filter @agent-world/server add playwright` + `playwright install chromium`） |

---

## 1. 每个平台要逆向的信息（填写前先收集）

以小红书为例，抖音/其他平台同理。**必须逐项确定，不能猜**：

| # | 要逆向的项 | 落到 adapter 哪里 |
|---|---|---|
| 1 | 登录页 URL（如 `https://creator.xiaohongshu.com/login`） | `login()` |
| 2 | 登录方式（扫码 / 手机号 / 密码） | `login()` |
| 3 | 登录成功的标志（某个元素出现，或 URL 跳到后台） | `login()` 的等待条件 |
| 4 | 创作者后台数据页 URL（如 `https://creator.xiaohongshu.com/note-manage`） | `fetchMetrics()` |
| 5 | 每条笔记的**容器**选择器（列表项） | `fetchMetrics()` |
| 6 | 笔记**链接/ID** 的选择器（对应 `external_content_id`） | `fetchMetrics()` |
| 7 | **曝光 / 点击 / 收藏 / 转化** 的选择器 | `fetchMetrics()` |
| 8 | **分页方式**（滚动加载 / 翻页按钮） | `fetchMetrics()` |
| 9 | 时间过滤方式（按 `since` 过滤） | `fetchMetrics()` |

> 逆向技巧：在数据页按 F12，用「选择元素」箭头点中目标数据，右键 → Copy → Copy selector；或用 `data-testid`/稳定 class，避开会变的 `div[class*="hash"]` 这类自动生成名。

---

## 2. 接入步骤

1. **写登录流程**（`adapters/xiaohongshu.ts` 的 `login`）：
   - `launchRpaBrowser({ headless: false })` 启动有头浏览器；
   - 打开登录页，等用户手动扫码（`page.waitForURL` 或等成功标志元素出现，超时给足）；
   - `saveSession(context, stateFile)` 持久化会话。

2. **写数据抓取**（`fetchMetrics`）：
   - 用持久化会话 `launchRpaBrowser({ stateFile })` 恢复登录态（免扫码）；
   - 打开数据页，按 `since` 过滤；
   - 遍历每条笔记，抓取 6/7 项字段，映射为 `FetchedMetric[]`；
   - 遵守 `RPA_MIN_INTERVAL_MS` 限速（两次操作间隔 ≥3s），分页滚动时尤其要限速。

3. **接到回写**：`collectMetrics` 返回的 `FetchedMetric[]` 交给 `/api/metrics`（或直接 `db.insertMetric`），按 `external_content_id` 回写 `content_metrics`。

4. **注册**：`registerMetricsAdapter(xiaohongshuAdapter)`（在 server 启动时注册）。

---

## 3. 合规红线（不可妥协）

| 红线 | 说明 |
|---|---|
| **只读不写** | 只回读后台数据，**绝不自动化发布**（发布走半自动 + 停在发布键，见 §F7-C） |
| **限速** | 两次操作间隔 ≥ `RPA_MIN_INTERVAL_MS`（3s），降低风控触发 |
| **headful** | 生产回读用有头模式，不做 headless 无人值守 |
| **测试号** | 先在测试号上跑通，再谈主号 |
| **常驻风险提示** | UI 上明确「第三方自动化有封号风险」 |

---

## 4. 验证清单（接入后逐项确认）

- [ ] `login` 能完成扫码并持久化 `storageState`。
- [ ] 二次运行 `fetchMetrics` 无需重新扫码（登录态复用）。
- [ ] `fetchMetrics` 至少抓到一条真实笔记的曝光/点击/转化。
- [ ] 指标能回写 `content_metrics`，`PerformanceDashboard` 能看到 ROI。
- [ ] 重复运行**幂等**（同一 `external_content_id` + 同一时间窗口不重复写入）。
- [ ] 断网/登录态过期时，抛「登录态过期，请重新扫码」而非静默返回空数据（对齐本项目「防 silent-success」的铁律）。

---

## 5. 当前状态

- **框架**：✅ 已落地（browser 生命周期 / storageState / adapter 接口 / 限速 / 注册表，4 例测试通过）。
- **选择器**：⏳ 待真实环境逆向（`xiaohongshuAdapter` 当前抛「尚未启用」诚实兜底）。
- **抖音及其他平台**：按同一 `MetricsAdapter` 接口各加一个 adapter 即可。
