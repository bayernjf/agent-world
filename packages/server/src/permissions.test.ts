import { describe, it, expect } from "vitest";
import type { Skill } from "@agent-world/core";
import { getSkill, registerSkill } from "./skills/registry.js";
import {
  evaluateToolCall,
  matchDomain,
  guardToolCall,
  PermissionDenied,
  type ToolOp,
} from "./permissions.js";

const webFetch = getSkill("web_fetch")!; // declares network: { domains: ["*"] }

function bare(over: Partial<Skill["permissions"]>): Skill {
  return {
    id: "x",
    name: "x",
    kind: "tool",
    source: "builtin",
    permissions: { subprocess: false, env: [], ...over },
    config: {},
    tool: { name: "x", description: "", parameters: {}, execute: async () => ({}) },
  };
}

describe("matchDomain", () => {
  it("matches wildcard and subdomain patterns", () => {
    expect(matchDomain("api.example.com", ["*"])).toBe(true);
    expect(matchDomain("a.foo.com", ["*.foo.com"])).toBe(true);
    expect(matchDomain("foo.com", ["*.foo.com"])).toBe(true);
    expect(matchDomain("bar.com", ["foo.com"])).toBe(false);
  });
});

describe("evaluateToolCall — network", () => {
  it("allows web_fetch to any host by default", () => {
    const op: ToolOp = { network: ["example.com"] };
    expect(evaluateToolCall(webFetch, op, {})).toBeNull();
  });
  it("denies when the server allowlist excludes the host", () => {
    const op: ToolOp = { network: ["evil.com"] };
    expect(evaluateToolCall(webFetch, op, { networkAllow: ["api.example.com"] })).toMatch(/not permitted/);
  });
  it("allows when the server allowlist includes the host", () => {
    const op: ToolOp = { network: ["api.example.com"] };
    expect(evaluateToolCall(webFetch, op, { networkAllow: ["api.example.com"] })).toBeNull();
  });
  it("denies network for a skill with no network grant", () => {
    expect(evaluateToolCall(bare({}), { network: ["x.com"] }, {})).toMatch(/not permitted/);
  });
});

describe("evaluateToolCall — filesystem", () => {
  const fsSkill = bare({ fs: { read: true, write: true, paths: ["/tmp/"] } });
  it("allows reads/writes under the declared path", () => {
    expect(evaluateToolCall(fsSkill, { fs: [{ path: "/tmp/a", write: true }] }, {})).toBeNull();
  });
  it("denies paths outside the declared prefix", () => {
    expect(evaluateToolCall(fsSkill, { fs: [{ path: "/etc/passwd", write: true }] }, {})).toMatch(/not permitted/);
  });
  it("honours a server-wide fs allowlist", () => {
    expect(evaluateToolCall(fsSkill, { fs: [{ path: "/tmp/a", write: true }] }, { fsAllow: ["/srv/"] })).toMatch(/not permitted/);
  });
});

describe("evaluateToolCall — subprocess", () => {
  it("denies by default", () => {
    expect(evaluateToolCall(bare({}), { subprocess: true }, {})).toMatch(/not granted/);
  });
  it("denies when disabled by server policy", () => {
    const sub = bare({ subprocess: true });
    expect(evaluateToolCall(sub, { subprocess: true }, { subprocessAllow: false })).toMatch(/disabled by server/);
  });
  it("allows when granted and not disabled", () => {
    expect(evaluateToolCall(bare({ subprocess: true }), { subprocess: true }, {})).toBeNull();
  });
});

describe("guardToolCall", () => {
  it("throws PermissionDenied for web_fetch outside the allowlist", () => {
    expect(() => guardToolCall("web_fetch", { url: "https://evil.com" }, { networkAllow: ["api.example.com"] })).toThrow(
      PermissionDenied,
    );
  });
  it("allows web_fetch within the allowlist", () => {
    expect(() =>
      guardToolCall("web_fetch", { url: "https://api.example.com" }, { networkAllow: ["api.example.com"] }),
    ).not.toThrow();
  });
});

describe("guardToolCall — declaration-driven derivation", () => {
  it("checks a card's own declared domains, not a hard-coded tool-name list", () => {
    registerSkill({
      id: "narrow_api",
      name: "Narrow API",
      description: "",
      kind: "tool",
      source: "local",
      permissions: { network: { domains: ["api.example.com"] }, subprocess: false, env: [] },
      config: {},
      tool: {
        name: "narrow_api",
        description: "",
        parameters: { type: "object", properties: {} },
        async execute() {
          return null;
        },
      },
    });
    expect(() => guardToolCall("narrow_api", { url: "https://api.example.com/x" }, {})).not.toThrow();
    expect(() => guardToolCall("narrow_api", { url: "https://evil.com/x" }, {})).toThrow(PermissionDenied);
  });

  it("finds URLs nested in the arguments, not just a top-level url key", () => {
    expect(() =>
      guardToolCall("narrow_api", { body: { callback: "https://evil.com/hook" } }, {}),
    ).toThrow(PermissionDenied);
  });

  it("ignores URL arguments on a card that declares no network permission", () => {
    registerSkill({
      id: "offline_card",
      name: "Offline",
      description: "",
      kind: "tool",
      source: "local",
      permissions: { subprocess: false, env: [] },
      config: {},
      tool: {
        name: "offline_card",
        description: "",
        parameters: { type: "object", properties: {} },
        async execute() {
          return null;
        },
      },
    });
    // No network declared, so nothing is derived — the card simply has no
    // network op to check. The declaration cannot stop a hard-coded fetch
    // inside execute; only process isolation can.
    expect(() => guardToolCall("offline_card", { url: "https://evil.com" }, {})).not.toThrow();
  });

  it("derives an fs write op from a path-shaped argument and enforces the server root", () => {
    expect(() => guardToolCall("fs_write", { path: "out.txt", content: "x" }, { fsAllow: ["/srv"] })).not.toThrow();
    expect(() =>
      guardToolCall("fs_write", { path: "/etc/passwd", content: "x" }, { fsAllow: ["/srv"] }),
    ).toThrow(PermissionDenied);
  });

  it("applies the operator subprocess kill switch to any card declaring it", () => {
    registerSkill({
      id: "spawner",
      name: "Spawner",
      description: "",
      kind: "tool",
      source: "local",
      permissions: { subprocess: true, env: [] },
      config: {},
      tool: {
        name: "spawner",
        description: "",
        parameters: { type: "object", properties: {} },
        async execute() {
          return null;
        },
      },
    });
    expect(() => guardToolCall("spawner", {}, {})).not.toThrow();
    expect(() => guardToolCall("spawner", {}, { subprocessAllow: false })).toThrow(PermissionDenied);
  });
});
