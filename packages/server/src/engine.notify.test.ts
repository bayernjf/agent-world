import { compile, replay, type Graph, type NotifyConfig } from "@agent-world/core";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execute } from "./engine.js";
import { fakeWorker } from "./worker.js";

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn(async () => ({ messageId: "<m1@example.com>" })),
      close: vi.fn(),
    })),
  },
}));

import nodemailer from "nodemailer";

function pngBytes(): Buffer {
  const png = new PNG({ width: 2, height: 2 });
  png.data = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  return PNG.sync.write(png);
}

interface Store {
  storeBinary: (data: Buffer, mimeType: string, label?: string) => string;
  readArtifact: (uri: string) => Promise<string | null>;
}

function artifactStore(): Store {
  const map = new Map<string, string>();
  return {
    storeBinary(data: Buffer, mimeType: string, _label?: string) {
      const id = `/api/artifacts/art-${map.size + 1}`;
      map.set(id, `data:${mimeType};base64,${data.toString("base64")}`);
      return id;
    },
    async readArtifact(uri: string) {
      return map.get(uri) ?? null;
    },
  };
}

async function collect(g: Graph, input?: string) {
  const { plan } = compile(g)!;
  const events: any[] = [];
  const store = artifactStore();
  for await (const e of execute({
    runId: "r",
    graph: g,
    plan: plan!,
    worker: fakeWorker(),
    budgetUsd: null,
    input,
    now: () => 0,
    storeBinary: store.storeBinary,
    readArtifact: store.readArtifact,
  })) {
    events.push(e);
  }
  return events;
}

function notifyGraph(notify: NotifyConfig): Graph {
  return {
    id: "g",
    name: "g",
    nodes: [
      { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
      { id: "nt", kind: "notify", name: "NOTIFY", x: 1, y: 0, notify },
      { id: "sink", kind: "sink", name: "SINK", x: 2, y: 0 },
    ],
    edges: [
      { id: "e1", from: "src", to: "nt", kind: "flow" },
      { id: "e2", from: "nt", to: "sink", kind: "flow" },
    ],
  };
}

function jsonOf(events: any[], nodeId: string): any | undefined {
  return events.find((e) => e.type === "artifact.produced" && e.nodeId === nodeId)?.artifact;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("notify node — outbound notifications", () => {
  it("sends a static message to a feishu group bot and emits a json artifact", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 0 }), { status: 200 }));
    const events = await collect(
      notifyGraph({ provider: "feishu", message: "build done", webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/abc12345" }),
    );
    expect(replay(events).status).toBe("done");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://open.feishu.cn/open-apis/bot/v2/hook/abc12345");
    expect(JSON.parse((init as any).body)).toEqual({
      msg_type: "text",
      content: { text: "build done" },
    });
    const art = jsonOf(events, "nt");
    expect(art.kind).toBe("json");
    expect(JSON.parse(art.content)).toMatchObject({ sent: true, provider: "feishu", chars: 10 });
  });

  it("falls back to the upstream text artifact as the message", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errcode: 0 }), { status: 200 }));
    const events = await collect(notifyGraph({ provider: "wecom", webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k1" }), "agent summary text");
    expect(replay(events).status).toBe("done");
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as any).body)).toEqual({
      msgtype: "text",
      text: { content: "agent summary text" },
    });
  });

  it("signs dingtalk webhooks when a secret is configured", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errcode: 0 }), { status: 200 }));
    const events = await collect(
      notifyGraph({ provider: "dingtalk", message: "hi", webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=tok", secret: "SEC123" }),
    );
    expect(replay(events).status).toBe("done");
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("timestamp=");
    expect(url).toContain("&sign=");
    expect(url).toContain("access_token=tok");
  });

  it("sends email via SMTP env credentials", async () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_USER", "bot@example.com");
    vi.stubEnv("SMTP_PASS", "secret-pass");
    const events = await collect(notifyGraph({ provider: "email", to: "boss@example.com", subject: "Daily report", message: "report body" }));
    expect(replay(events).status).toBe("done");
    expect(fetchMock).not.toHaveBeenCalled();
    const transport = (nodemailer.createTransport as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    const mail = await (transport.sendMail as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(mail).toMatchObject({ from: "bot@example.com", to: "boss@example.com", subject: "Daily report", text: "report body" });
    const art = jsonOf(events, "nt");
    expect(JSON.parse(art.content)).toMatchObject({ sent: true, provider: "email", detail: "boss@example.com" });
  });

  it("fails with AUTH when SMTP env credentials are missing", async () => {
    const events = await collect(notifyGraph({ provider: "email", to: "boss@example.com", message: "m" }));
    expect(replay(events).status).toBe("failed");
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "nt");
    expect(failed.errorCode).toBe("AUTH");
    expect(failed.error).toContain("SMTP_HOST");
  });

  it("fails with PROVIDER_ERROR when the platform rejects the message", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errcode: 310000, errmsg: "keyword not match" }), { status: 200 }));
    const events = await collect(notifyGraph({ provider: "dingtalk", message: "hi", webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=tok" }));
    expect(replay(events).status).toBe("failed");
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "nt");
    expect(failed.errorCode).toBe("PROVIDER_ERROR");
    expect(failed.error).toContain("keyword not match");
  });

  it("fails with VALIDATION when the webhook url is missing", async () => {
    const events = await collect(notifyGraph({ provider: "feishu", message: "hi" }));
    expect(replay(events).status).toBe("failed");
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "nt" && e.errorCode === "VALIDATION")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails with VALIDATION when there is no message and the upstream has no text", async () => {
    // The source brief is never empty (placeholder fallback), so use an
    // http(file) download as the upstream: it produces a file artifact, no text.
    vi.stubEnv("ALLOW_PRIVATE_NETWORK", "1");
    fetchMock.mockResolvedValue(new Response(pngBytes(), { status: 200, headers: { "content-type": "image/png" } }));
    const g: Graph = {
      id: "g",
      name: "g",
      nodes: [
        { id: "src", kind: "source", name: "SRC", x: 0, y: 0 },
        { id: "dl", kind: "http", name: "DL", x: 1, y: 0, http: { url: "https://files.example.com/p.png", outputMode: "file" } },
        { id: "nt", kind: "notify", name: "NOTIFY", x: 2, y: 0, notify: { provider: "feishu", webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/x" } },
        { id: "sink", kind: "sink", name: "SINK", x: 3, y: 0 },
      ],
      edges: [
        { id: "e1", from: "src", to: "dl", kind: "flow" },
        { id: "e2", from: "dl", to: "nt", kind: "flow" },
        { id: "e3", from: "nt", to: "sink", kind: "flow" },
      ],
    };
    const events = await collect(g);
    expect(replay(events).status).toBe("failed");
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "nt" && e.errorCode === "VALIDATION")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the http download
  });

  it("renders feishu markdown as an interactive card", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 0 }), { status: 200 }));
    const events = await collect(
      notifyGraph({ provider: "feishu", format: "markdown", message: "**bold** report", webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/abc", subject: "Daily" }),
    );
    expect(replay(events).status).toBe("done");
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as any).body);
    expect(body.msg_type).toBe("interactive");
    expect(body.card.elements[0]).toEqual({ tag: "markdown", content: "**bold** report" });
    expect(body.card.header.title).toEqual({ tag: "plain_text", content: "Daily" });
  });

  it("renders dingtalk and wecom markdown via their native msgtype", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errcode: 0 }), { status: 200 }));
    await collect(
      notifyGraph({ provider: "dingtalk", format: "markdown", message: "## H\nbody", webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=t", subject: "S" }),
    );
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as any).body)).toEqual({
      msgtype: "markdown",
      markdown: { title: "S", text: "## H\nbody" },
    });
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errcode: 0 }), { status: 200 }));
    await collect(
      notifyGraph({ provider: "wecom", format: "markdown", message: "**b**", webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k" }),
    );
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as any).body)).toEqual({
      msgtype: "markdown",
      markdown: { content: "**b**" },
    });
  });

  it("retries transient failures and succeeds on the second attempt", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0 }), { status: 200 }));
    const events = await collect(
      notifyGraph({ provider: "feishu", message: "hi", webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/x", retry: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 } }),
    );
    expect(replay(events).status).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry auth errors", async () => {
    // No SMTP env → NotifyAuthError on the first attempt, no retry.
    const events = await collect(
      notifyGraph({ provider: "email", to: "boss@example.com", message: "m", retry: { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0 } }),
    );
    expect(replay(events).status).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "nt" && e.errorCode === "AUTH")).toBe(true);
  });

  it("does not retry when the platform explicitly rejects the message", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errcode: 310000, errmsg: "keyword not match" }), { status: 200 }));
    const events = await collect(
      notifyGraph({ provider: "dingtalk", message: "hi", webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=t", retry: { maxRetries: 3, baseDelayMs: 0, maxDelayMs: 0 } }),
    );
    expect(replay(events).status).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry on NotifyProviderError
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "nt" && e.errorCode === "PROVIDER_ERROR")).toBe(true);
  });

  it("sends a message to a Slack channel via chat.postMessage", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const events = await collect(notifyGraph({ provider: "slack", channel: "C123", message: "deploy done" }));
    expect(replay(events).status).toBe("done");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect((init as any).headers.authorization).toBe("Bearer xoxb-test");
    expect(JSON.parse((init as any).body)).toEqual({ channel: "C123", text: "deploy done" });
    const art = jsonOf(events, "nt");
    expect(JSON.parse(art.content)).toMatchObject({ sent: true, provider: "slack", detail: "C123" });
  });

  it("fails with AUTH when SLACK_BOT_TOKEN is missing", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "");
    const events = await collect(notifyGraph({ provider: "slack", channel: "C1", message: "m" }));
    expect(replay(events).status).toBe("failed");
    expect(events.some((e) => e.type === "node.failed" && e.nodeId === "nt" && e.errorCode === "AUTH")).toBe(true);
  });

  it("fails with PROVIDER_ERROR when Slack returns ok:false", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-bad");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), { status: 200 }));
    const events = await collect(notifyGraph({ provider: "slack", channel: "C1", message: "m", retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 } }));
    expect(replay(events).status).toBe("failed");
    const failed = events.find((e) => e.type === "node.failed" && e.nodeId === "nt");
    expect(failed.errorCode).toBe("PROVIDER_ERROR");
    expect(failed.error).toContain("invalid_auth");
  });
});
