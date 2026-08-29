import type { NotifyConfig } from "@agent-world/core";
import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";

/**
 * Outbound notifications for the `notify` node. Group-bot providers
 * (feishu/dingtalk/wecom) POST a text message to the bot's webhook URL (kept in
 * the node config — one graph can notify different groups); email sends via
 * SMTP with credentials from env (SMTP_HOST / SMTP_PORT / SMTP_USER /
 * SMTP_PASS / SMTP_FROM), so the password never enters the graph.
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

async function assertOk(provider: string, url: string, res: Response): Promise<Record<string, unknown>> {
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
    throw new Error(
      `${provider} 通知发送失败: ${(json.msg ?? json.errmsg as string | undefined) ?? `HTTP ${res.status}`}`,
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

async function sendGroupBot(provider: string, cfg: NotifyConfig, message: string): Promise<NotifyResult> {
  if (!cfg.webhookUrl) {
    throw new NotifyAuthError(`缺少 webhookUrl（${provider} 群机器人需要在配置中填写 webhook 地址）`);
  }
  const url = provider === "dingtalk" && cfg.secret ? signDingTalk(cfg.webhookUrl, cfg.secret) : cfg.webhookUrl;
  const body =
    provider === "feishu"
      ? { msg_type: "text", content: { text: message } }
      : provider === "dingtalk"
        ? { msgtype: "text", text: { content: message } }
        : { msgtype: "text", text: { content: message } };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await assertOk(provider, url, res);
  const tail = url.slice(-8);
  return { provider, detail: `${provider} 群机器人 …${tail}` };
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

/** Deliver a notification message via the configured provider. Throws NotifyAuthError on auth problems. */
export async function sendNotification(cfg: NotifyConfig, message: string, subject: string): Promise<NotifyResult> {
  switch (cfg.provider) {
    case "feishu":
    case "dingtalk":
    case "wecom":
      return sendGroupBot(cfg.provider, cfg, message);
    case "email":
      return sendEmail(cfg, message, subject);
  }
}
