// OTLP/HTTP JSON trace export for agent-world (OTel plan phase 2).
//
// Opt-in by environment, same contract as zeus: OTEL_EXPORTER_OTLP_ENDPOINT
// unset means nothing is built and nothing dials out. When set, each /api
// request produces one span exported fire-and-forget — an export failure
// degrades observability, it never blocks the request path.
//
// Endpoint shape is the full OTLP/HTTP JSON path, e.g.
//   http://otel-collector:4318/v1/traces

import { randomBytes } from "node:crypto";

function hexId(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export type RequestSpanInput = {
  path: string;
  method: string;
  status: number;
  latencyMs: number;
};

type OtlpAttributeValue =
  | { stringValue: string }
  | { intValue: string }
  | { boolValue: boolean };

type OtlpAttribute = { key: string; value: OtlpAttributeValue };

function attr(key: string, value: string | number | boolean): OtlpAttribute {
  if (typeof value === "string") return { key, value: { stringValue: value } };
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  return { key, value: { intValue: String(value) } };
}

/** Export one request span. Noop when the endpoint is unset; never throws. */
export async function exportRequestSpan(input: RequestSpanInput): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return;

  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || "agent-world";
  const serviceVersion = process.env.OTEL_SERVICE_VERSION?.trim() || "dev";
  const environment = process.env.DEPLOY_ENV?.trim() || "local";

  const startMs = Date.now() - input.latencyMs;
  const startNano = BigInt(startMs) * 1_000_000n;
  const endNano = BigInt(startMs + input.latencyMs) * 1_000_000n;

  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attr("service.name", serviceName),
            attr("service.version", serviceVersion),
            attr("deployment.environment", environment),
          ],
        },
        scopeSpans: [
          {
            scope: { name: "agent-world" },
            spans: [
              {
                traceId: hexId(16),
                spanId: hexId(8),
                name: `${input.method} ${input.path}`,
                kind: 1, // SPAN_KIND_INTERNAL
                startTimeUnixNano: String(startNano),
                endTimeUnixNano: String(endNano),
                attributes: [
                  attr("http.method", input.method),
                  attr("http.route", input.path),
                  attr("http.status_code", input.status),
                ],
                // 2 = ERROR carries the refusal reason; 1 = OK.
                status:
                  input.status >= 500
                    ? { code: 2, message: `HTTP ${input.status}` }
                    : { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // fire-and-forget: an export failure must not affect the request path
  }
}
