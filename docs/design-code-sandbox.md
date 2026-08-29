# 代码节点运行沙箱设计方案

> 状态：P0（`6b2f92b`）+ P1（`ddb2e03`）+ **P2 外部沙箱后端已落地（bwrap / sandbox-exec / noop 可插拔，工作树）**；docker/podman 容器后端与 `net`/`fs` 策略字段待办。
> 关联：handoff 待办「运行沙箱细化」；代码节点当前实现在 `packages/server/src/engine.ts` 的 `node.kind === "code"` 分支 + `packages/server/src/code-sandbox.ts`。

## 实施进度（2026-08-29，P1 落地后）

- [x] **Phase P0 安全基线**：trimEnv 白名单 + 绝对解释器路径（跨运行缓存）+ 每次运行独立 temp dir（成功/失败/超时 finally 清理）。见 `6b2f92b`。
- [x] **Phase P1 资源限制**（工作树）：
  - `sh -c 'ulimit -t/-u/-f/-n && exec …'` 包裹 — POSIX 通用，用 `exec` 替换 shell 镜像不挂多余 PID；参数经 POSIX 单引号转义（含内嵌空格与 `'`）。Linux 额外加 `ulimit -v`（RLIMIT_AS macOS 不强制 malloc，诚实跳过）。
  - 全局限额 `DEFAULT_SANDBOX_LIMITS`（cpu 30s / nproc 128 / fsize 32MB / nofile 256 / vmem 2GB / node-old-space 512MB），每项可用 `CODE_LIMIT_*` 环境变量在**调用时**覆盖（不是 import 时快照，方便测试临时调参）。
  - Node JS 权限：`--permission`（≥ Node 22.2 稳定形式）或 `--experimental-permission`（Node 20 旧形式）——启动时对 `resolveInterpreter` 跑一次探针二选一，按解释器路径缓存。`--allow-fs-read=<workdir>` / `--allow-fs-write=<workdir>` 严格限到工作目录；不注入 `--allow-worker` / `--allow-child-process` / `--allow-addons` / `--allow-wasi`，所以子进程 / Worker / 原生 addon 都被 Node 拒绝。
  - **诚实边界已在测试注释中记录**：Node ≥ 24 的稳定 permission model 已**移除** `--allow-net` / `--deny-net` 粒度参数（只有 fs / child / worker / addon / wasi）。JS 代码的**网络隔离在 P1 不覆盖**，要靠 P2 的 OS 级后端（bwrap / sandbox-exec / 容器）。测试用「child_process 被拒绝」替代「fetch 被拒绝」，避免假装不具备的能力。
  - macOS `/var` → `/private/var` 符号链接修复：`createCodeWorkdir` 返回 `realpathSync()` 后的规范路径，spawn 的 `cwd` 和 Node 的 `--allow-fs-*` grant 两边都用同一身份，避免权限模型的 path-compare 错配。
  - 测试：code-sandbox 12/12 通过 + engine.code 11/11 通过。全 server suite 411 → 424 通过。
- [x] **Phase P2 外部沙箱后端（工作树）**：
  - `CodeSandboxBackend` 接口（`planSpawn` → command/argv），`resolveSandbox(env, probe)` 按 `CODE_SANDBOX` 选择：`rlimit`（默认）/ `bwrap` / `sandbox-exec` / `noop`；二进制缺失或名字不认识时**降级 rlimit + console.warn（warn-once，绝不静默）**；probe 可注入方便测试。
  - `bwrap`（Linux）：`--ro-bind / /` 只读根 + `--bind <workdir>` 唯一可写 + `--unshare-net/-pid/-uts/-ipc` + `--die-with-parent`；**JS/Python 一视同仁的 fs+net 隔离**。故意不加 `--unshare-cgroup`（无 cgroup v2 委派的机器会硬失败）。rlimit 仍由内层 bash wrapper 承担。
  - `sandbox-exec`（macOS seatbelt）：最小可信 profile `(deny default)(allow process*)(allow file-read*)(allow file-write* (subpath <workdir>))(deny network*)`。**坑 1**：新版 macOS 拒绝 `process-fork*`/`sysctl-read*`/`mach-lookup*` 等过滤器名（"unbound variable"），只能用最小集。**坑 2**：subpath grant 必须用 realpath 形式的 workdir（`/var` 软链的 grant 永远匹配不上）——`createCodeWorkdir` 已保证。**坑 3**：Node 24.0.0 的 V8 在 seatbelt 下 LowLevelAlloc 溢出崩溃（20/22 正常），live 测试先跑冒烟探针、崩溃即跳过并注明原因。
  - `noop`（逃生口）：裸 spawn，选它时 warn 一句「无 rlimit 无权限门」。
  - engine code 分支改走 `resolveSandbox().planSpawn(...)`；默认 rlimit 行为与 P1 完全一致，零回归。
  - 测试：424 → **437 通过**（+13：后端选择/降级告警、bwrap argv 形状、seatbelt profile 形状、noop 形状、live seatbelt「workdir 内可写 / Python 越界写被拒」在 macOS+Node≤22 真跑、live bwrap 在有 bwrap 的环境真跑）。
- [ ] **后续待办**：docker/podman 容器后端（生产）；`CodeNodeConfig` 的 `fs`/`net` 策略字段（§5）尚未实现，当前所有后端均为 deny-by-default 全隔离。

---

## 1. 背景与现状

code 节点（`NodeKind.code`，见 `packages/core/src/graph.ts` 的 `CodeNodeConfig`）允许产线作者在节点里写任意 JavaScript / Python 脚本，由 server 进程直接 `spawn` 一个子进程执行：

```
spawn(cfg.language === "python" ? "python3" : "node", ["-c" | "-e", cfg.code])
```

- stdin 传入 `{"inputs": {<上游节点id>: 值}}`，stdout 读取结果（单 JSON 对象/数组 → `json` 产物，否则 → `text` 产物），非零退出 → `node.failed`。

**已有防护（仅 3 项）**：
1. `timeoutMs`（默认 30000ms）超时后 `SIGKILL`
2. stdout / stderr 各自 cap 1MB，防输出刷屏
3. `withRetry` 瞬态重试（子进程启动失败等），非零退出是业务错误不重试

**缺失（本方案的靶子）**：环境变量、网络、文件系统、资源（内存/CPU/进程数/磁盘/fd）、工作目录——五类全部无隔离。当前 code 节点等于「在 server 用户权限下裸跑任意代码」。

---

## 2. 威胁模型

code 节点的脚本可能来自第三方产线作者，或由 AI 生成后未经人工审查直接跑。在 server 进程的直接子进程里，它可以：

| 威胁 | 具体手段 | 当前是否可能 |
|---|---|---|
| 密钥泄露 | `process.env` / `os.environ` 读 `JWT_SECRET`、provider API key、DB 路径 | ✅ 完全可能（子进程继承完整 env） |
| SSRF / 内网探测 | `fetch` / `http.request` / `urllib` 打 `169.254.169.254`、内网服务 | ✅ 完全可能（不经过 `ssrf.ts`） |
| 任意文件读写 | `fs` / `open` 读 `/etc/passwd`、删 `packages/server/agent-world.sqlite`、覆盖产物 | ✅ 完全可能 |
| 资源耗尽 | 内存炸弹（分配大数组）、`fork` 炸弹（无限 `fork()`）、挖矿（打满 CPU）、写满磁盘 | ✅ 内存/磁盘无限制；CPU 受 `timeoutMs` 但可先 fork 逃逸 |
| 持久化后门 | 写 `~/.bashrc` / cron / 改 server 源码（cwd 在源码目录时） | ✅ 完全可能 |

**信任边界结论**：code 节点是明确的信任边界，必须按「不可信代码」对待，采用 deny-by-default（默认拒绝，按需放行）。

---

## 3. 设计原则

1. **默认拒绝**：code 节点默认无网络、无共享文件系统、最小环境变量、隔离工作目录；需要能力时显式声明。
2. **分层渐进**：先做零依赖的安全基线（P0），再做 OS 资源限制（P1），最后接可选的外部强隔离后端（P2）。每一层都可独立上线、独立回退。
3. **复用现有资产**：`isolation.ts` 的 `trimEnv`（env 白名单）、`permissions.ts` 的 `networkAllow`/`fsAllow`、`ssrf.ts` 的 `hostIsInternal`（内网 IP 校验）。
4. **跨平台**：开发机 macOS + 生产 Docker/Linux 都要能跑；不同平台走不同后端，缺后端时明确降级并告警，不能悄悄变成「无沙箱」。
5. **诚实声明能力边界**：JS 与 Python 的隔离能力不对等（见 §6），文档与实现都不得假装 Python 有它没有的权限模型。

---

## 4. 方案分层

### P0 安全基线（零外部依赖，必做）

堵住最痛的「密钥泄露 + cwd 逃逸」，不引入任何新依赖：

1. **环境变量最小化**：复用 `isolation.ts` 的 `trimEnv(declared)` —— 子进程只收到 `SAFE_ENV_BASE`（PATH/HOME/TMPDIR/LANG/TZ 等安全项）+ 显式声明的 key，绝不传 `JWT_SECRET`/provider key/DB 路径。
2. **工作目录隔离**：每次运行在独立临时目录下执行 —— `/tmp/aw-code/<runId>-<nodeId>-<attempt>/`，`spawn` 的 `cwd` 指向它；脚本只能相对读写自己的目录；运行结束（含失败/超时）后清理该目录。
3. **解释器绝对路径**：`spawn` 不再依赖继承的 `PATH`（会被 env 污染指向恶意二进制）。启动时解析一次 `python3`/`node` 的绝对路径（`/usr/bin/python3`、node 的 `which` 结果）并缓存，此后固定使用；语言仍是枚举（javascript/python），不接受任意 executable 字符串。

> P0 不承诺网络/文件系统隔离（那需要 P1/P2 的机制），但通过 env 白名单 + cwd 隔离，先消除「读密钥」和「写源码/配置」两条最高危路径。

### P1 OS 资源限制（零/少外部依赖）

给子进程加 OS 级 `rlimit`，挡住资源耗尽：

| 限制 | 机制 | 防护 |
|---|---|---|
| CPU | `RLIMIT_CPU`（秒） | 挖矿 / 死循环打满 CPU |
| 进程数 | `RLIMIT_NPROC` | fork 炸弹 |
| 单文件大小 | `RLIMIT_FSIZE` | 写爆磁盘 |
| 文件描述符 | `RLIMIT_NOFILE` | fd 耗尽 |
| 内存 | Node `--max-old-space-size`；Python `ulimit -v`（Linux） | 内存炸弹 |

实现方式：Node 无原生 `setrlimit` API，故用 `sh -c 'ulimit -u <n> -c 0 -f <n> -n <n> && exec <解释器绝对路径> ...'` 包裹（`ulimit` 是 sh 内建，macOS/Linux 通用）；或用 `prlimit`（仅 Linux）。内存上限在 JS 侧用 Node 启动参数，Python 侧 `ulimit -v` 在 Linux 可靠、macOS 尽力而为（见 §7）。

网络 / 文件系统（JS 侧）用 Node 20+ 的 `--experimental-permission`：
- `--allow-fs-read=<workdir> --allow-fs-write=<workdir>`：文件访问锁死在临时目录
- `--allow-net` 不传 = 完全无网络
- （实验性，Node 22/24 可用；作为 JS 的 P1 项，Python 无等价物）

### P2 可插拔 OS 级沙箱后端（外部依赖，可选）

定义 `CodeSandbox` 接口，实现可插拔，按 `CODE_SANDBOX` 环境变量选择；缺二进制时**降级并 `console.warn`**（绝不静默变无沙箱）：

| 后端 | 平台 | 机制 | 覆盖 |
|---|---|---|---|
| `rlimit`（默认，P1 能力） | 通用 | `ulimit` + Node permission | 资源限制 + JS fs/net |
| `bwrap`（bubblewrap） | Linux | mount/pid/net namespace + 只读根 + 临时可写 + rlimit | JS/Python 全量 fs/net/进程隔离 |
| `sandbox-exec`（seatbelt） | macOS | 系统自带 seatbelt profile（`(deny default)(allow process*)(deny network*)(deny file-write*)`） | JS/Python 全量 fs/net 隔离 |
| `docker` / `podman`（生产） | Linux 容器内 | `--memory` / `--network=none` / `--read-only` + 临时卷 | 全量 |

> 覆盖差异的本质（§6）：`bwrap`/`sandbox-exec`/容器是**进程级 OS 隔离**，对 Python 和 JS 一视同仁；`--experimental-permission` 只是 Node 运行时能力，Python 享受不到。

---

## 5. 配置模型（拟扩展）

### `CodeNodeConfig` 扩展（`packages/core/src/graph.ts`，待实现）

```ts
export const CodeNodeConfig = z.object({
  language: z.enum(["javascript", "python"]).default("javascript"),
  code: z.string().default(""),
  timeoutMs: z.number().int().min(1000).default(30000),
  retry: RetryPolicy.default({ ... }),
  // —— 以下为沙箱扩展 ——
  /** 额外允许透传给子进程的环境变量 key（已在 SAFE_ENV_BASE 的除外）。 */
  env: z.array(z.string()).default([]),
  /** 文件系统策略：sandbox（默认，仅临时目录）| allowlist（复用 server fsAllow 前缀）。 */
  fs: z.enum(["sandbox", "allowlist"]).default("sandbox"),
  /** 网络策略：none（默认，无网络）| allowlist（复用 networkAllow，弱，见 §6）| proxy（经 ssrf 校验代理，P2）。 */
  net: z.enum(["none", "allowlist", "proxy"]).default("none"),
  /** 资源上限（缺省走 server 全局默认）。 */
  limits: z.object({
    cpuSec: z.number().optional(),
    maxMemoryMb: z.number().optional(),
    maxProcs: z.number().optional(),
    maxFileBytes: z.number().optional(),
    maxFd: z.number().optional(),
  }).optional(),
});
```

### server 全局环境变量（`loadConfig`，待实现）

| 变量 | 说明 | 默认 |
|---|---|---|
| `CODE_SANDBOX` | 后端选择：`rlimit` / `bwrap` / `sandbox-exec` / `noop` | `rlimit` |
| `CODE_SANDBOX_NET` | 全局网络策略覆盖 | `none` |
| `CODE_SANDBOX_FS` | 全局文件策略覆盖 | `sandbox` |
| `CODE_LIMIT_CPU_SEC` / `CODE_LIMIT_MAX_MB` / `CODE_LIMIT_MAX_PROCS` / `CODE_LIMIT_MAX_FILE_BYTES` / `CODE_LIMIT_MAX_FD` | 全局资源默认上限 | 见实现 |

---

## 6. 架构

```ts
// packages/server/src/code-sandbox.ts（新文件，待实现）
export interface CodeSandbox {
  /** 按语言 + 代码 + 限制生成一个受约束的 ChildProcess。 */
  spawn(opts: {
    language: "javascript" | "python";
    code: string;
    workdir: string;
    env: NodeJS.ProcessEnv;
    limits: CodeLimits;
  }): ChildProcess;
}

export class RlimitSandbox implements CodeSandbox { /* P0 + P1：trimEnv + cwd + ulimit 包裹 + Node permission */ }
export class BwrapSandbox implements CodeSandbox { /* P2：bwrap 命名空间 */ }
export class SandboxExecSandbox implements CodeSandbox { /* P2：seatbelt profile */ }
export class NoopSandbox implements CodeSandbox { /* 现状，仅测试/逃生口 */ }

export function resolveSandbox(env: NodeJS.ProcessEnv): CodeSandbox { /* 按 CODE_SANDBOX 选择，缺后端降级 + warn */ }
```

`engine.ts` 的 code 分支改为：生成临时 workdir → `resolveSandbox().spawn(...)` 取代裸 `spawn` → 收尾清理 workdir（`finally`）。

---

## 7. 能力边界与跨平台风险（务必诚实）

1. **Python 没有进程级权限模型**：`--experimental-permission` 是 Node 专属。Python 的 fs/网络隔离**只能靠 OS 层**（bwrap / sandbox-exec / 容器），`rlimit` 后端下 Python 的 fs/net 隔离是「尽力而为」而非强保证。若部署场景对 Python 沙箱有硬要求，必须上 P2 后端。
2. **macOS `RLIMIT_AS` 不可靠**：macOS 对 `RLIMIT_AS`（地址空间）历史上不强制 malloc。内存限制在 macOS 上：JS 靠 `--max-old-space-size`，Python 靠 `ulimit -v`（尽力）或 P2 后端。
3. **`sandbox-exec` 被 Apple 标记 deprecated**：macOS 仍自带可用，作为开发机过渡；生产 Linux 用 bwrap/容器。且新版 macOS 的 profile 过滤器名收紧（`process-fork*` 等不再合法）、**Node 24.0.0 在 seatbelt 下 V8 崩溃（20/22 正常）**——升级 Node 小版本前先跑 `sandbox-exec` 冒烟探针（测试里已内置）。
4. **bwrap 依赖 user namespaces**：部分云环境 / 内核默认禁用 unprivileged user namespaces，需降级到 `rlimit` 并告警。
5. **bwrap 依赖 user namespaces**：部分云环境 / 内核默认禁用 unprivileged user namespaces，需降级到 `rlimit` 并告警（resolveSandbox 已做）。
6. **`--experimental-permission` 仍是实验性**：Node 22/24 可用但接口可能变；不把它当作 Python 的替代品，只作为 JS 的 P1 增益。
7. **逃逸不可能 100% 杜绝**：code 节点是信任边界，配合产线作者权限（多租户落地后）做「谁能在谁的产线里跑代码」才是最终防线。

---

## 8. 分期与验收标准

### P0 安全基线
- [ ] code 子进程环境变量只含 `SAFE_ENV_BASE` + 声明的 `env`；`process.env.JWT_SECRET` / provider key 读不到
- [ ] `spawn` 的 `cwd` 指向每次运行独立的 `/tmp/aw-code/<runId>-<nodeId>-<attempt>/`，运行结束（含失败/超时）目录被清理
- [ ] 解释器使用启动时解析并缓存的绝对路径，不依赖继承 `PATH`
- [ ] 单元测试：env 白名单、cwd 隔离、目录清理、绝对路径

### P1 资源限制
- [ ] 内存炸弹被终止（JS `--max-old-space-size`；Python `ulimit -v` 尽力）
- [ ] fork 炸弹被 `RLIMIT_NPROC` 拦截
- [ ] JS 代码 `fs.readFile('/etc/passwd')` 被 `--experimental-permission` 拒绝、`fetch` 无网络
- [ ] 单元测试：CPU/进程数/文件大小/fd 上限生效，Node 权限拒绝 fs/net

### P2 外部沙箱后端
- [x] `bwrap` 后端：argv 形状（只读根 + workdir 唯一可写 + unshare-net/pid/uts/ipc）；有 bwrap 的环境 live 真跑（本机/CI 均无 bwrap 时跳过）
- [x] `sandbox-exec` 后端：macOS 下 file-write 越界被 seatbelt 拒绝（Python live 验证）；workdir 内可写（Node ≤ 22 live 验证；Node 24.0.0 有 V8 崩溃 bug，探针跳过）
- [x] 缺后端时降级到 `rlimit` 并 `console.warn`（不静默，warn-once）
- [x] 测试：`CODE_SANDBOX` 选择/未知值降级/告警断言；恶意脚本样例拦截由 P1 测试延续（rlimit 后端下），bwrap/sandbox-exec 后端的恶意样例依赖对应二进制存在
- [ ] docker/podman 容器后端（生产）待办

---

## 9. 参考资料

- `packages/server/src/isolation.ts` — 现有 worker plugin 子进程隔离（`trimEnv` / fs 拦截 / fetch 代理）
- `packages/server/src/permissions.ts` — 网络/文件系统/子进程 allowlist 模型
- `packages/server/src/ssrf.ts` — 出站内网 IP 校验
- `packages/core/src/graph.ts` — `CodeNodeConfig` 当前定义
- Node `--experimental-permission` / `bubblewrap`(bwrap) / macOS `sandbox-exec`(seatbelt)
