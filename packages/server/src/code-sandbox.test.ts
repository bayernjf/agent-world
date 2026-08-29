import { describe, expect, it } from "vitest";
import { access } from "node:fs/promises";
import { resolveInterpreter, createCodeWorkdir, cleanupCodeWorkdir } from "./code-sandbox.js";

describe("resolveInterpreter", () => {
  it("resolves node to an absolute path", () => {
    const p = resolveInterpreter("javascript");
    expect(p).toContain("node");
    expect(p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)).toBe(true);
  });

  it("caches the resolved path across calls", () => {
    const a = resolveInterpreter("javascript");
    const b = resolveInterpreter("javascript");
    expect(a).toBe(b);
  });
});

describe("code workdir", () => {
  it("creates an isolated temp dir and cleans it up", async () => {
    const dir = await createCodeWorkdir("r1", "n1", 1);
    expect(dir).toContain("aw-code-");
    await access(dir); // exists
    await cleanupCodeWorkdir(dir);
    await expect(access(dir)).rejects.toThrow();
  });

  it("sanitizes run/node ids in the directory name", async () => {
    const dir = await createCodeWorkdir("r<1>", "n#sub:1", 2);
    expect(dir).toContain("aw-code-");
    expect(dir).not.toContain("<");
    expect(dir).not.toContain(">");
    expect(dir).not.toContain("#");
    expect(dir).not.toContain(":");
    await cleanupCodeWorkdir(dir);
  });
});

/* ---------------- P1: limits resolution + rlimit wrapper ---------------- */

import { platform, tmpdir } from "node:os";
import type { CodeSandboxLimits } from "./code-sandbox.js";
import {
  DEFAULT_SANDBOX_LIMITS,
  buildRlimitWrapper,
  buildNodePermissionArgs,
  planCodeSpawn,
  resolveLimits,
} from "./code-sandbox.js";

describe("resolveLimits", () => {
  it("returns defaults when given no overrides", () => {
    const l = resolveLimits();
    expect(l.cpuSec).toBeGreaterThan(0);
    expect(l.maxProcs).toBeGreaterThan(0);
    expect(l.nodeMaxOldSpaceMb).toBeGreaterThan(0);
  });

  it("picks explicit overrides on top of defaults", () => {
    const l = resolveLimits({ cpuSec: 3, nodeMaxOldSpaceMb: 64 });
    expect(l.cpuSec).toBe(3);
    expect(l.nodeMaxOldSpaceMb).toBe(64);
    // untouched fields still carry defaults
    expect(l.maxFd).toBe(DEFAULT_SANDBOX_LIMITS.maxFd);
  });

  it("reads CODE_LIMIT_* env overrides into the defaults snapshot", () => {
    // The DEFAULT_ snapshot is taken at module import; validate that at least
    // one env var actually produced the documented behaviour by re-implementing
    // the numEnv rule locally against a known-good pattern.
    const envVal = process.env.CODE_LIMIT_CPU_SEC;
    const l = resolveLimits();
    if (envVal !== undefined && envVal !== "") {
      expect(l.cpuSec).toBe(Math.floor(Number(envVal)));
    } else {
      expect(l.cpuSec).toBe(DEFAULT_SANDBOX_LIMITS.cpuSec);
    }
  });
});

describe("buildRlimitWrapper", () => {
  const limits: Required<CodeSandboxLimits> = {
    cpuSec: 11,
    maxProcs: 23,
    maxFileKb: 45,
    maxFd: 67,
    virtualMemoryKb: 89,
    nodeMaxOldSpaceMb: 123,
  };

  it("wraps with /bin/bash -c and execs through to the interpreter", () => {
    const w = buildRlimitWrapper({
      interpreterPath: "/usr/bin/node",
      interpreterArgs: ["-e", "console.log(1)"],
      limits,
    });
    expect(w.command).toBe("/bin/bash");
    expect(w.args[0]).toBe("-c");
    const script = w.args[1];
    expect(script).toContain("ulimit -t 11");
    expect(script).toContain("ulimit -u 23");
    expect(script).toContain("ulimit -f 45");
    expect(script).toContain("ulimit -n 67");
    // Linux-only virtual memory gate
    if (platform() === "linux") expect(script).toContain("ulimit -v 89");
    else expect(script).not.toContain("ulimit -v");
    // Replaces shell image with the interpreter (no extra PID in the tree)
    expect(script).toContain("exec '/usr/bin/node' '-e' 'console.log(1)'");
  });

  it("shell-quotes arguments that carry embedded spaces and single quotes", () => {
    const w = buildRlimitWrapper({
      interpreterPath: "/weird path/node",
      interpreterArgs: ["-e", "console.log('x')"],
      limits,
    });
    const script = w.args[1];
    expect(script).toContain("'/weird path/node'");
    // Shell quoting correctness: actually execute the script with a known
    // node (which sh resolves to). If quoting is wrong the script fails
    // (syntax error or prints nothing we can recognize).
    const execPath = process.execPath;
    // Execute with production-safe limits, NOT the tiny fake ones above:
    // `ulimit -v 89` (KB) on Linux kills Node before it can even boot.
    const runtime = buildRlimitWrapper({
      interpreterPath: execPath,
      interpreterArgs: ["-e", "console.log('x')"],
      limits: resolveLimits(),
    });
    // Use spawnSync to run the wrapper with a timeout. rlimits will be
    // applied but the one-liner finishes in ms so it doesn't hit any cap.
    const { spawnSync: spawn } = require("node:child_process") as typeof import("node:child_process");
    const r = spawn(runtime.command, runtime.args, {
      encoding: "utf8",
      timeout: 10000,
      // EOF on stdin: if quoting ever regresses and node drops into REPL
      // mode, it exits at EOF instead of hanging until the timeout (a
      // CI Linux run showed exactly that silent-hang signature).
      input: "",
      // Mirror the engine's spawn conditions (trimmed env), not the vitest
      // worker's full environment.
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: tmpdir() },
    });
    expect(r.status)
      .withContext(`signal=${r.signal} err=${r.error?.message} stdout=${r.stdout} stderr=${r.stderr}`)
      .toBe(0);
    expect(r.stdout.trim().split(/\n/)[0]).toBe("x");
  });
});

describe("buildNodePermissionArgs", () => {
  it("locks FS to workdir and enables no-network default", () => {
    const a = buildNodePermissionArgs({
      interpreterPath: resolveInterpreter("javascript"),
      workdir: "/tmp/aw-code-abc/",
      limits: { ...DEFAULT_SANDBOX_LIMITS, nodeMaxOldSpaceMb: 96 },
    });
    // Gate flag: either --permission (Node ≥ 22.2 stable) or --experimental-permission
    // (older Node). If neither is supported by the resolved interpreter the probe
    // records "none" and emits no gate, so fall back to checking there's an FS
    // grant at minimum.
    const hasGate = a.includes("--permission") || a.includes("--experimental-permission");
    expect(a).toContain("--allow-fs-read=/tmp/aw-code-abc/");
    expect(a).toContain("--allow-fs-write=/tmp/aw-code-abc/");
    expect(a).toContain("--max-old-space-size=96");
    // Never grant --allow-net — P1's JS sandbox must be zero-network by default.
    if (hasGate) {
      // Either stable (--permission) or experimental form; both have the
      // word "permission" in them so match case-insensitively on a leading `--`.
      const found = a.some((f) => /^--(experimental-)?permission$/i.test(f));
      expect(found).withContext(`flags=${a.join(" ")}`).toBe(true);
    }
    expect(a).toContain("--allow-fs-read=/tmp/aw-code-abc/");
    expect(a).toContain("--allow-fs-write=/tmp/aw-code-abc/");
    expect(a).toContain("--max-old-space-size=96");
    // Never grant --allow-net — P1's JS sandbox must be zero-network by default.
    expect(a.some((f) => f.startsWith("--allow-net"))).toBe(false);
  });
});

describe("planCodeSpawn", () => {
  it("returns a wrapped /bin/bash command for JS scripts", () => {
    const plan = planCodeSpawn({
      language: "javascript",
      code: "console.log(1)",
      workdir: "/tmp/wd",
      limits: { cpuSec: 1 },
    });
    expect(plan.command).toBe("/bin/bash");
    expect(plan.wrapped).toBe(true);
    expect(plan.limits.cpuSec).toBe(1);
    const script = plan.args[1];
    // Either stable --permission or legacy --experimental-permission flag.
    // Wrapper shell-quotes each argv so the flag appears as '--permission'.
    const permFlagged = (script.match(/'?--(experimental-)?permission'?/g) ?? []).length > 0;
    expect(permFlagged).withContext(script).toBe(true);
    expect(script).toContain("--allow-fs-read=/tmp/wd");
    expect(script).toContain("'console.log(1)'");
  });

  it("returns a wrapped /bin/bash command for python (no permission flags)", () => {
    const plan = planCodeSpawn({
      language: "python",
      code: "print(1)",
      workdir: "/tmp/wd",
    });
    const script = plan.args[1];
    expect(script).toContain("ulimit -t");
    expect(script).toContain("'print(1)'");
    // Permission model is JS-only; never inject it into python3 argv.
    expect(/--(experimental-)?permission(?:=|$|\s)/.test(script)).toBe(false);
  });
});

/* ---------------- P2: pluggable OS sandbox backends ---------------- */

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, vi } from "vitest";
import {
  bwrapBackend,
  binaryAvailable,
  buildSeatbeltProfile,
  noopBackend,
  resolveSandbox,
  sandboxExecBackend,
} from "./code-sandbox.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveSandbox (P2 backend selection)", () => {
  it("defaults to rlimit when CODE_SANDBOX is unset or empty", () => {
    expect(resolveSandbox({}).name).toBe("rlimit");
    expect(resolveSandbox({ CODE_SANDBOX: "" }).name).toBe("rlimit");
  });

  it("returns bwrap when requested and the binary is present", () => {
    const b = resolveSandbox({ CODE_SANDBOX: "bwrap" }, () => true);
    expect(b.name).toBe("bwrap");
  });

  it("returns sandbox-exec when requested and the binary is present", () => {
    const b = resolveSandbox({ CODE_SANDBOX: "sandbox-exec" }, () => true);
    expect(b.name).toBe("sandbox-exec");
  });

  it("degrades to rlimit with a loud warn when the requested binary is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveSandbox({ CODE_SANDBOX: "bwrap" }, () => false).name).toBe("rlimit");
    expect(resolveSandbox({ CODE_SANDBOX: "sandbox-exec" }, () => false).name).toBe("rlimit");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain("degrading to rlimit");
  });

  it("degrades to rlimit with a warn on an unknown backend name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveSandbox({ CODE_SANDBOX: "gvisor" }, () => true).name).toBe("rlimit");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("unknown CODE_SANDBOX");
  });

  it("noop is selectable (escape hatch) and warns about the missing sandbox", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveSandbox({ CODE_SANDBOX: "noop" }, () => true).name).toBe("noop");
    expect(warn.mock.calls[0][0]).toContain("WITHOUT rlimits");
  });
});

describe("bwrap backend", () => {
  it("plans a read-only root, writable workdir, no network, inner rlimit wrapper", () => {
    const plan = bwrapBackend.planSpawn({ language: "javascript", code: "console.log(1)", workdir: "/tmp/wd" });
    expect(plan.command).toBe("bwrap");
    const a = plan.args;
    // ro root + writable workdir bind
    const roIdx = a.indexOf("--ro-bind");
    expect(a[roIdx + 1]).toBe("/");
    expect(a[roIdx + 2]).toBe("/");
    const bindIdx = a.indexOf("--bind");
    expect(a[bindIdx + 1]).toBe("/tmp/wd");
    expect(a[bindIdx + 2]).toBe("/tmp/wd");
    expect(a).toContain("--unshare-net");
    expect(a).toContain("--unshare-pid");
    expect(a).toContain("--die-with-parent");
    // inner command is the bash ulimit wrapper with JS permission flags
    const bashIdx = a.indexOf("/bin/bash");
    const script = a[bashIdx + 2];
    expect(script).toContain("ulimit -t");
    expect(script).toContain("--allow-fs-read=/tmp/wd");
  });

  it("live: executes node under bwrap when the binary exists", async () => {
    if (!binaryAvailable("bwrap")) return; // skipped where bwrap is absent
    const plan = bwrapBackend.planSpawn({
      language: "javascript",
      code: "console.log('bwrap-ok')",
      workdir: await createCodeWorkdir("p2bwrap", "n", 1),
    });
    try {
      const r = spawnSync(plan.command, plan.args, { encoding: "utf8", timeout: 15000 });
      expect(r.status).withContext(`stderr=${r.stderr}`).toBe(0);
      expect(r.stdout.trim()).toBe("bwrap-ok");
    } finally {
      await cleanupCodeWorkdir(plan.args[plan.args.indexOf("--bind") + 1]);
    }
  }, 20000);
});

describe("sandbox-exec backend", () => {
  it("builds a deny-by-default seatbelt profile locked to the workdir", () => {
    const profile = buildSeatbeltProfile("/tmp/wd");
    expect(profile).toContain("(deny default)");
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain("(allow file-read*)");
    expect(profile).toContain('(allow file-write* (subpath "/tmp/wd"))');
  });

  it("plans sandbox-exec -p <profile> with the inner rlimit wrapper", () => {
    const plan = sandboxExecBackend.planSpawn({ language: "python", code: "print(1)", workdir: "/tmp/wd" });
    expect(plan.command).toBe("sandbox-exec");
    expect(plan.args[0]).toBe("-p");
    expect(plan.args[1]).toContain("(deny default)");
    expect(plan.args[2]).toBe("/bin/bash");
    expect(plan.args[4]).toContain("ulimit -t");
  });

  /**
   * Node 24.0.0's V8 crashes under seatbelt (LowLevelAlloc arithmetic
   * overflow, SIGABRT) — Node 20/22 are fine. Probe first and skip the
   * live run on affected builds instead of reporting a false regression.
   */
  function nodeBootsUnderSeatbelt(wd: string): boolean {
    const profile = buildSeatbeltProfile(wd);
    const r = spawnSync("sandbox-exec", ["-p", profile, process.execPath, "-e", "0"], {
      encoding: "utf8",
      timeout: 10000,
    });
    return r.status === 0;
  }

  it("live: JS writes inside the workdir succeed under seatbelt (macOS)", async () => {
    if (!binaryAvailable("sandbox-exec")) return;
    const wd = await createCodeWorkdir("p2seat", "ok", 1);
    if (!nodeBootsUnderSeatbelt(wd)) {
      await cleanupCodeWorkdir(wd);
      return; // Node 24.0.0 seatbelt crash — see comment above
    }
    try {
      const plan = sandboxExecBackend.planSpawn({
        language: "javascript",
        code: `require("fs").writeFileSync(${JSON.stringify(join(wd, "out.txt"))}, "x"); console.log("ok")`,
        workdir: wd,
      });
      const r = spawnSync(plan.command, plan.args, { encoding: "utf8", timeout: 15000 });
      expect(r.status).withContext(`stderr=${r.stderr}`).toBe(0);
      expect(r.stdout.trim()).toBe("ok");
    } finally {
      await cleanupCodeWorkdir(wd);
    }
  }, 20000);

  it("live: writes outside the workdir are denied by seatbelt, even for python (macOS)", async () => {
    if (!binaryAvailable("sandbox-exec")) return;
    if (!binaryAvailable("python3")) return;
    const wd = await createCodeWorkdir("p2seat", "deny", 1);
    const outside = join(wd, "..", "aw-seatbelt-should-deny");
    try {
      const plan = sandboxExecBackend.planSpawn({
        language: "python",
        code: `open(${JSON.stringify(outside)}, "w").write("x")`,
        workdir: wd,
      });
      const r = spawnSync(plan.command, plan.args, { encoding: "utf8", timeout: 15000 });
      // Seatbelt (not a Node runtime feature) must be what denies this.
      expect(r.status).not.toBe(0);
    } finally {
      rmSync(outside, { force: true });
      await cleanupCodeWorkdir(wd);
    }
  }, 20000);
});

describe("noop backend (escape hatch)", () => {
  it("spawns the interpreter directly: no ulimit wrapper, no permission flags", () => {
    const plan = noopBackend.planSpawn({ language: "javascript", code: "console.log(1)", workdir: "/tmp/wd" });
    expect(plan.wrapped).toBe(false);
    expect(plan.args).toEqual(["-e", "console.log(1)"]);
    expect(plan.command).toContain("node");
  });
});

describe("fs policy plumbing (extraFsReadPaths)", () => {
  it("planCodeSpawn repeats --allow-fs-read per extra path (JS)", () => {
    const plan = planCodeSpawn({
      language: "javascript",
      code: "console.log(1)",
      workdir: "/tmp/wd",
      extraFsReadPaths: ["/data/a", "/data/b"],
    });
    const script = plan.args[plan.args.length - 1] as string;
    expect(script).toContain("--allow-fs-read=/data/a");
    expect(script).toContain("--allow-fs-read=/data/b");
    // write grant stays workdir-only
    expect(script).toContain("--allow-fs-write=/tmp/wd");
    expect(script).not.toContain("--allow-fs-write=/data");
  });

  it("bwrap backend keeps the read-only root (extras are no-ops there)", () => {
    const plan = bwrapBackend.planSpawn({
      language: "javascript",
      code: "console.log(1)",
      workdir: "/tmp/wd",
      extraFsReadPaths: ["/data/a"],
    });
    const roIdx = plan.args.indexOf("--ro-bind");
    expect(plan.args[roIdx + 1]).toBe("/");
    expect(plan.args[roIdx + 2]).toBe("/");
  });
});
