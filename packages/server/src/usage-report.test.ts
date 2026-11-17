import { describe, expect, it, vi } from "vitest";
import { buildUsageReportBody, reportModelUsage } from "./usage-report.js";

const env = {
  MODEL_HUB_URL: "https://hub.example.com",
  MODEL_HUB_TOKEN: "hub-token",
} as NodeJS.ProcessEnv;

describe("buildUsageReportBody", () => {
  it("carries the assignment id and token counts the hub prices against", () => {
    const body = buildUsageReportBody(
      {
        feature: "textgen",
        provider: "hub-ark",
        model: "m-text",
        assignmentId: "asn_ark_text",
        tokensIn: 12,
        tokensOut: 34,
        cachedTokens: 5,
        reasoningTokens: 7,
      },
      env,
    );
    expect(body).toMatchObject({
      project: "agent-world",
      feature: "textgen",
      billing_source: "builtin",
      provider: "hub-ark",
      model: "m-text",
      assignment_id: "asn_ark_text",
      input_tokens: 12,
      output_tokens: 34,
      cache_read_tokens: 5,
      reasoning_tokens: 7,
      http_status: 200,
      cached: false,
    });
    expect(typeof body.ts).toBe("string");
    expect(new Date(String(body.ts)).toISOString()).toBe(body.ts);
  });

  it("uses MODEL_HUB_PROJECT when set", () => {
    const body = buildUsageReportBody(
      { feature: "judge", provider: "hub-ark", model: "m" },
      { ...env, MODEL_HUB_PROJECT: "tier0-local" } as NodeJS.ProcessEnv,
    );
    expect(body.project).toBe("tier0-local");
  });

  it("downgrades a malformed assignment id to null instead of failing the strict schema", () => {
    const body = buildUsageReportBody(
      { feature: "textgen", provider: "hub-ark", model: "m", assignmentId: "not-an-assignment" },
      env,
    );
    expect(body.assignment_id).toBeNull();
  });

  it("sends quantity only when the call is billed per unit", () => {
    const token = buildUsageReportBody({ feature: "textgen", provider: "hub-ark", model: "m" }, env);
    expect("quantity" in token).toBe(false);
    const image = buildUsageReportBody(
      { feature: "image", provider: "hub-ark", model: "m-image", quantity: 2 },
      env,
    );
    expect(image.quantity).toBe(2);
  });
});

describe("reportModelUsage", () => {
  it("does nothing when the hub env is not configured", () => {
    const fetchImpl = vi.fn();
    reportModelUsage(
      { feature: "textgen", provider: "hub-ark", model: "m" },
      { env: {} as NodeJS.ProcessEnv, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts to /pub/v1/usage with a bearer token and swallows a rejected report", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    reportModelUsage(
      { feature: "video", provider: "hub-ark", model: "m-video", quantity: 5 },
      { env, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hub.example.com/pub/v1/usage");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer hub-token");
    // A non-2xx response is logged, never thrown: give the promise a tick.
    await Promise.resolve();
  });

  it("swallows a network error without surfacing it to the caller", () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    expect(() =>
      reportModelUsage(
        { feature: "textgen", provider: "hub-ark", model: "m" },
        { env, fetchImpl: fetchImpl as unknown as typeof fetch },
      ),
    ).not.toThrow();
  });
});
