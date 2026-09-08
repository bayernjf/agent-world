# 浏览器自动验收（Chrome DevTools MCP）

让 Claude 直接驱动一个**真实 Chrome** 对部署环境（staging / 生产 / 本地 dev server）做 UI 验收：截图、点按钮、读 DOM、看 console。典型用途是「合并到 dev 且部署到 Hasee 后，验证某功能在真实环境跑通」。

不是 computer use——拿不到你日常那个已登录 Chrome 窗口的会话，原因见下。它驱动的是一个**独立 profile 的 Chrome 实例**，你在那个窗口登录一次，之后复用。

---

## 为什么不能直接接管你正在用的 Chrome

Chrome 136+ 起，`--remote-debugging-port` 对**默认 profile 目录被显式禁用**（防止本机进程通过 CDP 窃取已登录 Cookie）。所以「让自动化连进我现在这个登录好的窗口」这条路，Chrome 官方已经堵死。

可行做法是：起一个 Chrome 用**独立的 `--user-data-dir`**，它有自己的 Cookie 存储，在里面登录一次即可长期复用。

## 前置条件

- macOS 上装有 Google Chrome（默认路径 `/Applications/Google Chrome.app`）。
- Node 24（仓库要求 Node 24；`chrome-devtools-mcp` 也需 Node 22+）。默认 shell 的 `node` 可能是 20.x，下面注册命令里显式指向 Node 24 的绝对路径，避免踩这个坑。
- 验收目标是网页应用——staging、生产，或本地 `pnpm dev` 都行。

---

## 步骤（一次性配置 + 每次使用）

### 1. 起带调试端口的独立 Chrome（每次开工前）

```bash
nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-claude" \
  --no-first-run --no-default-browser-check \
  >/dev/null 2>&1 & disown
```

确认端口通了：

```bash
curl -s http://127.0.0.1:9222/json/version
```

能看到 `"Browser": "Chrome/..."` 即成功。**第一次**在这个窗口里打开验收目标地址并登录一次；Cookie 存在 `~/.chrome-claude`，以后不用再登。

> 想让 Chrome 一启动就打开目标站点，在上面命令末尾加一个 URL 参数即可（如 staging 地址）。

### 2. 注册 MCP server（一次性）

在仓库根目录执行（`local` scope：写进 `~/.claude.json` 的本项目配置，**不**落到仓库，不会随开源代码外泄）：

```bash
claude mcp add --scope local chrome-devtools -- \
  "$HOME/.local/share/fnm/node-versions/v24.20.0/installation/bin/npx" \
  -y chrome-devtools-mcp@latest --browserUrl=http://127.0.0.1:9222
```

`--browserUrl` 是「挂载」模式：MCP 只连接上一步已起好的 Chrome，自己不另开浏览器。所以顺序永远是**先起 Chrome，再让 Claude 干活**。

> 如果你的 fnm Node 24 路径不同，用 `fnm exec --using=24 -- node -e 'console.log(process.execPath)'` 查出实际路径，把上面命令里的 `npx` 换成同目录下的 npx。

验证注册：

```bash
claude mcp list
# codegraph:       ✔ Connected
# chrome-devtools: ✔ Connected
```

### 3. 重启会话

MCP 工具在**会话启动时**加载。在 Code 标签里对**同一文件夹开一个新会话**即可，不必退出 App。新会话里 Claude 就有 `navigate_page` / `take_snapshot` / `click` / `fill` / `take_screenshot` / `list_console_messages` 等原生浏览器工具。

### 4. 使用

直接让 Claude 做，例如：

> 「打开 `<staging 地址>`，打开成本报表，截个图，看看单价缺口警告在不在。」

Claude 会驱动那个已登录的 Chrome 完成，不用你手动点。

---

## 不重启会话的临时办法（Playwright 直连）

MCP 工具要新会话才有；但 Chrome 已起着的情况下，**当前会话**也能用 Playwright 临时连上去——仓库 `packages/server` 已依赖 `playwright`。写个临时脚本（放 `/tmp`，不进仓库），核心就两行：

```js
// 用 node -e 'console.log(require.resolve("playwright"))' 在 packages/server 下查出实际路径
import pw from "<repo>/node_modules/.pnpm/playwright@<版本>/node_modules/playwright/index.js";
const browser = await pw.chromium.connectOverCDP("http://127.0.0.1:9222");
```

之后 `browser.contexts()[0].pages()` 拿到页面，`page.goto / click / fill / evaluate / screenshot` 都能用。注意两点：playwright 是 CommonJS 包，`.mjs` 里要用 `import pw from "..."; const { chromium } = pw;` 默认导入（不能用具名导入）；脚本用 Node 24 跑。脚本末尾务必 `process.exit(0)`（CDP 连接保活会让 Node 进程挂住，stdout 被缓冲，不退出就看不到输出）。这是一次性脚本，正式验收用上面的 MCP 方式。

---

## 安全注意

- **9222 端口开放期间，本机任何进程都能驱动该 Chrome、读取它的 Cookie**。因此：
  - 用独立 profile（`~/.chrome-claude`），**不要**在这个窗口里登录你的主 Google 账号或其他无关敏感服务，只登要验收的环境。
  - 用完关掉那个 Chrome 窗口（端口随之关闭）。
- 该 profile 路径和 9222 均为**本地开发环境**配置，属个人机器约定，**不要**写进仓库的 `.mcp.json`（用 `local` scope 正是为此）。
- 验收 staging / 生产时，按仓库日志与文档惯例：主机地址、IP、密钥等敏感信息一律不写进文档，用占位符。

## 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| MCP 连不上 / 工具无响应 | 9222 没在。先跑第 1 步的 `curl` 检查；Chrome 窗口被关了就重启它。 |
| `connect ECONNREFUSED 127.0.0.1:9222`（Playwright 脚本） | 同上，调试 Chrome 没起或已退出。 |
| `claude mcp` 报 node 版本错误 | MCP server 被 node 20 启动了。确认注册命令里用的是 Node 24 的 npx 绝对路径。 |
| 新会话里没有浏览器工具 | MCP 在会话启动时加载，需开新会话；或 `claude mcp list` 看是否未 Connected。 |
| 页面跳回登录页 | 独立 profile 还没登录，在那个 Chrome 窗口里登一次。 |
