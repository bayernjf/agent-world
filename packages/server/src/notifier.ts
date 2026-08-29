import type { NotifyConfig } from "@agent-world/core";
import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import { withRetry } from "./retry.js";

/**
 * Outbound notifications for the `notify` node. Group-bot providers
 * (feishu/dingtalk/wecom) POST a text or markdown message to the bot's webhook
 * URL (kept in the node config — one graph can notify different groups); email
 * sends via SMTP with credentials from env (SMTP_HOST / SMTP_PORT / SMTP_USER /
 * SMTP_PASS / SMTP_FROM), so the password never enters the graph.
 *
 * Two non-retryable error classes mark problems retrying cannot fix:
 * - NotifyAuthError: missing/invalid credentials or webhook (→ AUTH)
 * - NotifyProviderError: the platform explicitly rejected the message, e.g.
 *   a non-zero errcode like DingTalk's "keyword not matched" (→ PROVIDER_ERROR)
 * Transient faults (network reject, 5xx, SMTP connection drop) are retried
 * with exponential backoff per `cfg.retry` before bubbling up.
 */

export interface NotifyResult {
  provider: string;
  /** Human-readable destination (masked webhook tail or recipient address). */
  detail: string;
}

export class NotifyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotifyAuthError";
  }
}

export class NotifyProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotifyProviderError";
  }
}

async function assertOk(provider: string, res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = {};
  }
  if (res.status === 401 || res.status === 403) {
    throw new NotifyAuthError(`${provider} webhook 鉴权失败（${res.status}）`);
  }
  // All three group-bot APIs report success with a code/errcode of 0.
  const code = (json.code ?? json.errcode ?? (res.ok ? 0 : -1)) as number;
  if (code !== 0) {
    throw new NotifyProviderError(
      `${provider} 通知发送失败: ${(json.msg ?? (json.errmsg as string | undefined)) ?? `HTTP ${res.status}`}`,
    );
  }
  return json;
}

/** DingTalk signed bots: append &timestamp=…&sign=HMAC-SHA256(secret, timestamp). */
function signDingTalk(url: string, secret: string): string {
  const timestamp = Date.now();
  const sign = createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64");
  return `${url}${url.includes("?") ? "&" : "?"}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
}

/** Build the webhook request body for the provider + format. */
function groupBotBody(
  provider: string,
  format: "text" | "markdown",
  message: string,
  subject: string,
): Record<string, unknown> {
  if (format === "markdown") {
    if (provider === "feishu") {
      return {
        msg_type: "interactive",
        card: {
          header: { title: { tag: "plain_text", content: subject } },
          elements: [{ tag: "markdown", content: message }],
        },
      };
    }
    if (provider === "dingtalk") {
      return { msgtype: "markdown", markdown: { title: subject || message.slice(0, 20), text: message } };
    }
    return { msgtype: "markdown", markdown: { content: message } }; // wecom
  }
  // Plain text.
  if (provider === "feishu") return { msg_type: "text", content: { text: message } };
  return { msgtype: "text", text: { content: message } }; // dingtalk / wecom
}

async function sendGroupBot(
  provider: string,
  cfg: NotifyConfig,
  message: string,
  subject: string,
): Promise<NotifyResult> {
  if (!cfg.webhookUrl) {
    throw new NotifyAuthError(`缺少 webhookUrl（${provider} 群机器人需要在配置中填写 webhook 地址）`);
  }
  const url = provider === "dingtalk" && cfg.secret ? signDingTalk(cfg.webhookUrl, cfg.secret) : cfg.webhookUrl;
  const body = groupBotBody(provider, cfg.format, message, subject);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await assertOk(provider, res);
  const tail = url.slice(-8);
  return { provider, detail: `${provider} 群机器人 …${tail}` };
}

async function sendSlack(cfg: NotifyConfig, message: string): Promise<NotifyResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new NotifyAuthError("缺少环境变量 SLACK_BOT_TOKEN（Slack 通知需配置 Bot Token）");
  }
  if (!cfg.channel) {
    throw new NotifyAuthError("缺少 channel（Slack 通知需在配置中填写 channel id）");
  }
  // Slack always returns HTTP 200; success is signalled by `ok: true` in the body.
  // mrkdwn is Slack's own flavour of markdown; we pass the message through so
  // users can write *bold*, ~strike~, `<url|text>` per Slack's syntax.
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel: cfg.channel, text: message }),
  });
  const json = await assertOk("slack", res);
  if (json.ok !== true) {
    throw new NotifyProviderError(`Slack 通知发送失败: ${(json.error as string | undefined) ?? "unknown"}`);
  }
  return { provider: "slack", detail: cfg.channel };
}

async function sendEmail(cfg: NotifyConfig, message: string, subject: string): Promise<NotifyResult> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    throw new NotifyAuthError(
      "邮件发送需要 SMTP_HOST / SMTP_USER / SMTP_PASS 环境变量（可选 SMTP_PORT / SMTP_FROM）",
    );
  }
  if (!cfg.to) throw new NotifyAuthError("缺少收件人（email 通知需要在配置中填写 to）");
  const port = Number(process.env.SMTP_PORT ?? 465);
  const from = process.env.SMTP_FROM ?? user;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  try {
    await transporter.sendMail({ from, to: cfg.to, subject, text: message });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/auth|credential|535|login/i.test(msg)) throw new NotifyAuthError(`SMTP 认证失败: ${msg}`);
    throw new Error(`邮件发送失败: ${msg}`);
  } finally {
    transporter.close();
  }
  return { provider: "email", detail: cfg.to };
}

/**
 * Deliver a notification message via the configured provider, retrying transient
 * faults. Throws NotifyAuthError on auth problems, NotifyProviderError when the
 * platform explicitly rejects the message.
 */
export async function sendNotification(cfg: NotifyConfig, message: string, subject: string): Promise<NotifyResult> {
  return withRetry(
    () => {
      switch (cfg.provider) {
        case "feishu":
        case "dingtalk":
        case "wecom":
          return sendGroupBot(cfg.provider, cfg, message, subject);
        case "slack":
          return sendSlack(cfg, message);
        case "email":
          return sendEmail(cfg, message, subject);
      }
    },
    cfg.retry,
    (err) => !(err instanceof NotifyAuthError || err instanceof NotifyProviderError),
  );
}
