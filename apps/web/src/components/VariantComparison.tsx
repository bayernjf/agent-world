import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Graph, RuntimeState } from "@agent-world/core";

interface Props {
  graph: Graph;
  runtime: RuntimeState;
  /** Fanout or select node id whose lanes we render. */
  nodeId: string;
}

interface LaneContent {
  variant: string;
  output: string;
  ok: boolean;
  error?: string;
}

/** Walk incoming flow edges from the select node to find its fanout. */
function findUpstreamFanout(graph: Graph, selectId: string): string | null {
  const seen = new Set<string>();
  const stack = [selectId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of graph.edges) {
      if (e.kind !== "flow" || e.to !== cur || seen.has(e.from)) continue;
      const from = graph.nodes.find((n) => n.id === e.from);
      if (from?.kind === "fanout") return e.from;
      seen.add(e.from);
      stack.push(e.from);
    }
  }
  return null;
}

/** Read the per-lane contents a fanout published in its variant summary artifact. */
function readLanes(runtime: RuntimeState, fanoutId: string | null): LaneContent[] {
  if (!fanoutId) return [];
  const arts = runtime.nodes[fanoutId]?.artifacts ?? [];
  const json = arts.find((a) => a.kind === "json" && a.id.includes("-variants"));
  if (!json?.content) return [];
  try {
    const parsed = JSON.parse(json.content) as { variants?: LaneContent[] };
    return parsed.variants ?? [];
  } catch {
    return [];
  }
}

/**
 * F1: side-by-side variant lanes at a fanout (lane contents + status) or a
 * select node (contents + score + reason + chosen/failed flags).
 */
export default function VariantComparison({ graph, runtime, nodeId }: Props) {
  const { t } = useTranslation();
  const group = runtime.variants[nodeId];

  const { isSelect, lanes, ranking, chosen, failed } = useMemo(() => {
    const isSelect = group?.kind === "select";
    const fanoutId = isSelect ? findUpstreamFanout(graph, nodeId) : nodeId;
    const lanes = readLanes(runtime, fanoutId);
    const ranking = group?.ranking ?? [];
    return {
      isSelect,
      lanes,
      ranking,
      chosen: new Set(group?.chosen ?? []),
      failed: new Set(group?.failed ?? []),
    };
  }, [graph, runtime, nodeId, group]);

  if (!group) return null;

  const scoreOf = (variant: string): number | null =>
    ranking.find((r) => r.variant === variant)?.score ?? null;
  const reasonOf = (variant: string): string | undefined =>
    ranking.find((r) => r.variant === variant)?.reason;

  const items: LaneContent[] = lanes.length
    ? lanes
    : (ranking.length
        ? ranking.map((r) => ({
            variant: r.variant,
            output: "",
            ok: !failed.has(r.variant),
            error: failed.has(r.variant) ? "failed" : undefined,
          }))
        : []);

  if (items.length === 0) return null;

  return (
    <section className="variant-compare">
      <h3 className="label">
        {isSelect
          ? t("nodes:inspector.select.variantCards")
          : t("nodes:inspector.fanout.laneCards")}
      </h3>
      {failed.size > 0 && (
        <p className="variant-compare__failed muted">
          {t("nodes:inspector.select.failedLanes", { n: failed.size, lanes: [...failed].join(", ") })}
        </p>
      )}
      <div className="variant-compare__grid">
        {items.map((lane) => {
          const isChosen = chosen.has(lane.variant);
          const score = scoreOf(lane.variant);
          const reason = reasonOf(lane.variant);
          return (
            <article
              key={lane.variant}
              className={[
                "variant-card",
                isChosen ? "is-chosen" : "",
                !lane.ok ? "is-failed" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <header className="variant-card__head">
                <span className="variant-card__name">{lane.variant}</span>
                {isChosen && (
                  <span className="variant-card__chosen">{t("nodes:inspector.select.chosen")}</span>
                )}
                {score != null && (
                  <span className={`variant-card__score ${score >= 7 ? "is-good" : score >= 4 ? "is-warn" : "is-bad"}`}>
                    {score.toFixed(1)}
                  </span>
                )}
              </header>
              {!lane.ok && (
                <p className="variant-card__error">{lane.error ?? t("nodes:inspector.select.laneFailed")}</p>
              )}
              {lane.ok && lane.output && (
                <p className="variant-card__output">{lane.output}</p>
              )}
              {reason && <p className="variant-card__reason muted">{reason}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
