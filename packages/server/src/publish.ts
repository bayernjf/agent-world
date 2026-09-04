import { guardedFetch } from "./ssrf.js";

/**
 * F7-B: open-channel publishing. A thin `Publisher` abstraction with a single
 * universally-available provider today — `webhook` (POST a platform-ready
 * package to a self-hosted middle tier). Feishu/DingTalk/WeChat adapters can be
 * added behind the same interface as independent increments; every provider
 * shares the same credential handling (node config → encrypted at rest) and the
 * same SSRF boundary via guardedFetch.
 */

export interface PublishPayload {
  title: string;
  body: string;
  tags: string[];
}

/** Decrypted target config passed to a provider. */
export interface PublishTarget {
  provider: string;
  /** For webhook: the destination URL. */
  url: string;
  /** Optional bearer/secret token. */
  token?: string;
}

export interface PublishResult {
  externalId?: string;
  externalUrl?: string;
  detail: unknown;
}

export class PublishAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishAuthError";
  }
}

export class PublishProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishProviderError";
  }
}

/** POST a platform-ready package to a webhook target and map the response. */
async function publishWebhook(target: PublishTarget, payload: PublishPayload): Promise<PublishResult> {
  if (!target.url) throw new PublishAuthError("webhook 发布缺少目标 URL");
  let res: Response;
  try {
    res = await guardedFetch(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(target.token ? { authorization: `Bearer ${target.token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new PublishProviderError(`webhook 请求失败：${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let detail: unknown = text;
  try {
    detail = text ? JSON.parse(text) : {};
  } catch {
    /* keep raw text */
  }
  if (!res.ok) {
    throw new PublishProviderError(`webhook 返回 ${res.status}`);
  }
  const id =
    (detail as { id?: unknown })?.id != null ? String((detail as { id: unknown }).id) : undefined;
  const url =
    (detail as { url?: unknown })?.url != null ? String((detail as { url: unknown }).url) : undefined;
  return { externalId: id, externalUrl: url, detail };
}

/** Dispatch a publish to the configured provider. */
export async function publishToChannel(
  target: PublishTarget,
  payload: PublishPayload,
): Promise<PublishResult> {
  switch (target.provider) {
    case "webhook":
      return publishWebhook(target, payload);
    default:
      throw new PublishProviderError(`不支持的发布渠道：${target.provider}`);
  }
}
