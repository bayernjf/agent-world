import { describe, it, expect } from "vitest";
import type { Skill } from "@agent-world/core";
import { getSkill } from "./skills/registry.js";
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
