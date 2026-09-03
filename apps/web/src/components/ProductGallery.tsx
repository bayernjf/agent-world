import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ARTIFACT_COLORS,
  type Graph,
  type RuntimeState,
} from "@agent-world/core";
import {
  api,
  proxyImageUrl,
  type RunSummary,
  type StoredArtifact,
} from "../lib/api";
import { JsonView, renderMarkdown, safeParse } from "../lib/artifact-renderers";
import FinishedProduct from "./FinishedProduct";
import { useTranslation } from "react-i18next";
import { formatShortDateTime } from "../i18n/utils";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
}

type KindFilter = "all" | StoredArtifact["kind"];

const KIND_LABEL: Record<StoredArtifact["kind"], string> = {
  text: "modals:productGallery.kinds.text",
  image: "modals:productGallery.kinds.image",
  video: "modals:productGallery.kinds.video",
  audio: "modals:productGallery.kinds.audio",
  file: "modals:productGallery.kinds.file",
  json: "modals:productGallery.kinds.json",
  uri: "modals:productGallery.kinds.uri",
};

const FILTERS: KindFilter[] = [
  "all",
  "image",
  "video",
  "audio",
  "text",
  "json",
  "file",
  "uri",
];
const PAGE = 60;
const RUN_PAGE = 20;

const RUN_STATUS_LABEL: Record<string, string> = {
  running: "modals:productGallery.runStatus.running",
  done: "modals:productGallery.runStatus.done",
  completed: "modals:productGallery.runStatus.completed",
  failed: "modals:productGallery.runStatus.failed",
  cancelled: "modals:productGallery.runStatus.cancelled",
  halted: "modals:productGallery.runStatus.halted",
};

function resolveUrl(a: StoredArtifact): string | null {
  const raw =
    a.uri ??
    (a.storage === "local"
      ? `/api/artifacts/${encodeURIComponent(a.id)}`
      : null);
  return proxyImageUrl(raw);
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function ProductGallery({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<KindFilter>("all");
  const [view, setView] = useState<"kind" | "pipeline" | "run">("kind");
  const [items, setItems] = useState<StoredArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [detail, setDetail] = useState<StoredArtifact | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsLoading, setRunsLoading] = useState(false);
  const [viewRun, setViewRun] = useState<RunSummary | null>(null);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    try {
      const page = await api.listArtifacts(PAGE, offset);
      setItems((prev) => (offset === 0 ? page : [...prev, ...page]));
      setHasMore(page.length === PAGE);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async (offset: number) => {
    setRunsLoading(true);
    try {
      const d = await api.listRuns({ limit: RUN_PAGE, offset });
      setRuns((prev) => (offset === 0 ? d.runs : [...prev, ...d.runs]));
      setRunsTotal(d.total);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  // Reset whenever the modal opens or the kind filter changes.
  useEffect(() => {
    if (open) void load(0);
  }, [open, filter, load]);

  useEffect(() => {
    if (open && view === "run") void loadRuns(0);
  }, [open, view, loadRuns]);

  useEffect(() => {
    if (!open || detail || viewRun) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, detail, viewRun, onClose]);

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((a) => a.kind === filter)),
    [items, filter],
  );

  const groups = useMemo(() => {
    if (view !== "pipeline") return null;
    const m = new Map<string, StoredArtifact[]>();
    for (const a of filtered) {
      const key = a.graphName ?? t("modals:productGallery.unassignedGraph");
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(a);
    }
    return Array.from(m, ([name, arts]) => ({ name, arts }));
  }, [filtered, view]);

  const runGroups = useMemo(() => {
    if (view !== "run") return null;
    const m = new Map<string, RunSummary[]>();
    for (const r of runs) {
      const key = r.graph_name || t("modals:productGallery.unnamedGraph");
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return Array.from(m, ([name, rs]) => ({ name, rs }));
  }, [runs, view]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:productGallery.title")}</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {view !== "run" && (
              <div className="seg">
                {FILTERS.map((k) => (
                  <button
                    key={k}
                    className={`seg__btn ${filter === k ? "is-on" : ""}`}
                    onClick={() => setFilter(k)}
                  >
                    {k === "all"
                      ? t("modals:productGallery.all")
                      : t(KIND_LABEL[k])}
                  </button>
                ))}
              </div>
            )}
            <div className="seg">
              <button
                className={`seg__btn ${view === "kind" ? "is-on" : ""}`}
                onClick={() => setView("kind")}
              >
                {t("modals:productGallery.byKind")}
              </button>
              <button
                className={`seg__btn ${view === "pipeline" ? "is-on" : ""}`}
                onClick={() => setView("pipeline")}
              >
                {t("modals:productGallery.byPipeline")}
              </button>
              <button
                className={`seg__btn ${view === "run" ? "is-on" : ""}`}
                onClick={() => setView("run")}
              >
                {t("modals:productGallery.byRun")}
              </button>
            </div>
            <Tooltip content={t("common.close")}>
              <button className="icon-btn" onClick={onClose}>
                ✕
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="modal__body">
          {view === "run" ? (
            runsLoading && runs.length === 0 ? (
              <p
                className="muted"
                style={{ textAlign: "center", padding: "40px 0" }}
              >
                {t("modals:productGallery.loading")}
              </p>
            ) : runs.length === 0 ? (
              <p
                className="muted"
                style={{ textAlign: "center", padding: "40px 0" }}
              >
                {t("modals:productGallery.noRuns")}
              </p>
            ) : (
              runGroups!.map((g) => (
                <section key={g.name} className="gallery-group">
                  <h3 className="gallery-group__title">
                    {g.name}
                    <span>{g.rs.length}</span>
                  </h3>
                  <div className="runhistory-list">
                    {g.rs.map((r) => (
                      <div
                        key={r.id}
                        className="runhistory-row"
                        onClick={() => setViewRun(r)}
                      >
                        <div className="runhistory-row-main">
                          <div className="runhistory-row-title">
                            <span
                              className={`run-status run-status--${r.status}`}
                            >
                              {RUN_STATUS_LABEL[r.status]
                                ? t(RUN_STATUS_LABEL[r.status]!)
                                : r.status}
                            </span>
                            <span className="runhistory-id">
                              {r.id.slice(0, 8)}
                            </span>
                          </div>
                          <div className="runhistory-row-meta">
                            <span>{formatShortDateTime(r.started_at)}</span>
                            <span>
                              {t("modals:productGallery.duration")}{" "}
                              {r.ended_at != null
                                ? fmtDuration(r.ended_at - r.started_at)
                                : t("modals:productGallery.runStatus.running")}
                            </span>
                            <span>{r.trigger}</span>
                          </div>
                        </div>
                        <button
                          className="btn btn--ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewRun(r);
                          }}
                        >
                          {t("modals:productGallery.viewProduct")}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )
          ) : filtered.length === 0 && !loading ? (
            <p
              className="muted"
              style={{ textAlign: "center", padding: "40px 0" }}
            >
              {t("modals:productGallery.noProducts")}
            </p>
          ) : view === "pipeline" && groups ? (
            groups.map((g) => (
              <section key={g.name} className="gallery-group">
                <h3 className="gallery-group__title">
                  {g.name}
                  <span>{g.arts.length}</span>
                </h3>
                <div className="gallery">
                  {g.arts.map((a) => (
                    <GalleryCard key={a.id} artifact={a} onOpen={setDetail} />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="gallery">
              {filtered.map((a) => (
                <GalleryCard key={a.id} artifact={a} onOpen={setDetail} />
              ))}
            </div>
          )}

          {view === "run" && runs.length < runsTotal && (
            <div className="gallery__more">
              <button
                className="btn btn--ghost"
                disabled={runsLoading}
                onClick={() => void loadRuns(runs.length)}
              >
                {runsLoading
                  ? t("modals:productGallery.loading")
                  : t("modals:productGallery.loadMore")}
              </button>
            </div>
          )}

          {view !== "run" && hasMore && filter === "all" && (
            <div className="gallery__more">
              <button
                className="btn btn--ghost"
                disabled={loading}
                onClick={() => void load(items.length)}
              >
                {loading
                  ? t("modals:productGallery.loading")
                  : t("modals:productGallery.loadMore")}
              </button>
            </div>
          )}
        </div>
      </div>
      {detail && <ArtifactDetail a={detail} onClose={() => setDetail(null)} />}
      {viewRun && (
        <RunProductViewer run={viewRun} onClose={() => setViewRun(null)} />
      )}
    </div>
  );
}

function GalleryImageThumb({ url }: { url: string }) {
  const { t } = useTranslation();
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="gallery-card__doc">
        <div className="gallery-card__doc-icon">IMG</div>
        <div className="gallery-card__doc-name">
          {t("modals:productGallery.imageBroken")}
        </div>
        <a
          className="gallery-card__doc-link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {t("modals:productGallery.openOriginal")}
        </a>
      </div>
    );
  }
  return (
    <img
      className="gallery-card__img"
      src={url}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

function GalleryThumb({ a }: { a: StoredArtifact }) {
  const { t } = useTranslation();
  const url = resolveUrl(a);
  if (a.kind === "image") {
    return url ? (
      <GalleryImageThumb url={url} />
    ) : (
      <div className="gallery-card__empty">
        {t("modals:productGallery.noImage")}
      </div>
    );
  }
  if (a.kind === "video" && url) {
    return <video className="gallery-card__img" src={url} muted />;
  }
  const color = ARTIFACT_COLORS[a.kind] ?? "#ffb020";
  const icon =
    a.kind === "json"
      ? "{ }"
      : a.kind === "audio"
        ? "AUD"
        : a.kind === "video"
          ? "VID"
          : a.kind === "file"
            ? "FILE"
            : a.kind === "uri"
              ? "URI"
              : "TXT";
  const hint =
    a.kind === "text" || a.kind === "json"
      ? t("modals:productGallery.viewBody")
      : t("modals:productGallery.viewDetail");
  return (
    <div className="gallery-card__doc" style={{ borderTopColor: color }}>
      <div className="gallery-card__doc-icon" style={{ color }}>
        {icon}
      </div>
      <div className="gallery-card__doc-name" title={a.label ?? a.id}>
        {a.label ?? a.id}
      </div>
      <div className="gallery-card__doc-meta">
        {t(KIND_LABEL[a.kind])} · {formatSize(a.sizeBytes)}
      </div>
      <div className="gallery-card__doc-hint">{hint}</div>
    </div>
  );
}

function GalleryCard({
  artifact: a,
  onOpen,
}: {
  artifact: StoredArtifact;
  onOpen: (a: StoredArtifact) => void;
}) {
  const { t } = useTranslation();
  const color = ARTIFACT_COLORS[a.kind] ?? "#ffb020";
  const title = a.label ?? `${t(KIND_LABEL[a.kind])} · ${a.id}`;
  return (
    <div
      className="gallery-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(a)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(a);
        }
      }}
    >
      <div className="gallery-card__bar" style={{ background: color }} />
      <div className="gallery-card__media">
        <GalleryThumb a={a} />
      </div>
      <div className="gallery-card__meta">
        <span className="gallery-card__title" title={title}>
          {title}
        </span>
        <span className="gallery-card__sub muted mono">
          {formatShortDateTime(a.createdAt)}
          {a.sizeBytes ? ` · ${formatSize(a.sizeBytes)}` : ""}
        </span>
      </div>
    </div>
  );
}

function ArtifactDetail({
  a,
  onClose,
}: {
  a: StoredArtifact;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const color = ARTIFACT_COLORS[a.kind] ?? "#ffb020";
  const klabel = KIND_LABEL[a.kind] ? t(KIND_LABEL[a.kind]) : a.kind;
  const date = formatShortDateTime(a.createdAt);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const needsFetch = a.kind === "text" || a.kind === "json";
  const url = a.uri;

  useEffect(() => {
    if (!needsFetch || !url) return;
    let cancelled = false;
    setText(null);
    setErr(null);
    setLoading(true);
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch((e) => {
        if (!cancelled) setErr(String((e as Error)?.message ?? e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [a.id, url, needsFetch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    if (text == null) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  const download = () => {
    if ((a.kind === "text" || a.kind === "json") && text != null) {
      const blob = new Blob([text], { type: a.mimeType || "text/plain" });
      const u = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = u;
      link.download =
        a.label || `${a.id}.${a.kind === "json" ? "json" : "txt"}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(u);
    } else if (url) {
      window.open(url, "_blank", "noopener");
    }
  };

  return (
    <div
      className="gallery-detail"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="gallery-detail__panel" role="dialog" aria-modal="true">
        <header
          className="gallery-detail__header"
          style={{ borderBottom: `2px solid ${color}` }}
        >
          <div className="gallery-detail__title">
            <span
              className="gallery-detail__kind"
              style={{ color, borderColor: color }}
            >
              {klabel}
            </span>
            <span className="gallery-detail__name" title={a.label ?? a.id}>
              {a.label ?? a.id}
            </span>
          </div>
          <button
            className="gallery-detail__close icon-btn"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ✕
          </button>
          <div className="gallery-detail__sub">
            <span>{formatSize(a.sizeBytes)}</span>
            <span>·</span>
            <span>{date}</span>
            <span>·</span>
            <span>
              {a.storage === "local"
                ? t("modals:productGallery.storageLocal")
                : a.storage === "uri"
                  ? t("modals:productGallery.storageUri")
                  : t("modals:productGallery.storageMeta")}
            </span>
            {url && (
              <>
                <span>·</span>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {t("modals:productGallery.originalLink")}
                </a>
              </>
            )}
          </div>
        </header>
        <div className="gallery-detail__body">
          {a.kind === "text" &&
            (loading ? (
              <div className="gallery-detail__status">
                {t("modals:productGallery.loading")}
              </div>
            ) : err ? (
              <div className="gallery-detail__status gallery-detail__error">
                {t("modals:productGallery.loadBodyFailed", { err })}
              </div>
            ) : text == null ? (
              <div className="gallery-detail__status">
                {t("modals:productGallery.bodyUnavailable")}
              </div>
            ) : (
              <div className="artifact-md">{renderMarkdown(text)}</div>
            ))}
          {a.kind === "json" &&
            (loading ? (
              <div className="gallery-detail__status">
                {t("modals:productGallery.loading")}
              </div>
            ) : err ? (
              <div className="gallery-detail__status gallery-detail__error">
                {t("modals:productGallery.loadFailed", { err })}
              </div>
            ) : text == null ? (
              <div className="gallery-detail__status">
                {t("modals:productGallery.bodyUnavailable")}
              </div>
            ) : (
              <JsonView data={safeParse(text)} />
            ))}
          {a.kind === "image" &&
            (url ? (
              <div className="gallery-detail__image">
                <img src={proxyImageUrl(url) ?? ""} alt={a.label ?? ""} />
              </div>
            ) : (
              <div className="gallery-detail__status">
                {t("modals:productGallery.noImage")}
              </div>
            ))}
          {a.kind === "video" &&
            (url ? (
              <video
                className="gallery-detail__media"
                src={url}
                controls
                preload="metadata"
              />
            ) : (
              <div className="gallery-detail__status">
                {t("modals:productGallery.noVideo")}
              </div>
            ))}
          {a.kind === "audio" &&
            (url ? (
              <audio
                className="gallery-detail__media"
                src={url}
                controls
                preload="none"
              />
            ) : (
              <div className="gallery-detail__status">
                {t("modals:productGallery.noAudio")}
              </div>
            ))}
          {(a.kind === "file" || a.kind === "uri") && (
            <div className="gallery-detail__file">
              <div>{t("modals:productGallery.noPreview")}</div>
              {url && (
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {t("modals:productGallery.openLink")}
                </a>
              )}
            </div>
          )}
        </div>
        <footer className="gallery-detail__footer">
          {(a.kind === "text" || a.kind === "json") && (
            <>
              <button className="chip" onClick={copy} disabled={text == null}>
                {t("modals:productGallery.copy")}
              </button>
              <button
                className="chip"
                onClick={download}
                disabled={text == null}
              >
                {t("modals:productGallery.download")}
              </button>
            </>
          )}
          {a.kind === "image" && url && (
            <>
              <a className="chip" href={url} target="_blank" rel="noopener noreferrer">
                {t("modals:productGallery.openImage")}
              </a>
              <a className="chip" href={url} download={a.label ?? true}>
                {t("modals:productGallery.download")}
              </a>
            </>
          )}
          {(a.kind === "video" || a.kind === "audio") && url && (
            <a className="chip" href={url} download={a.label ?? true}>
              {t("modals:productGallery.download")}
            </a>
          )}
          <button className="chip" onClick={onClose}>
            {t("common.close")}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Renders one historical run's final product: the snapshot graph taken when
 * the run started plus the replayed runtime state, fed into the same
 * FinishedProduct view used on the live canvas.
 */
function RunProductViewer({
  run,
  onClose,
}: {
  run: RunSummary;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<{
    graph: Graph;
    runtime: RuntimeState;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErr(null);
    Promise.all([api.runGraph(run.id), api.getEvents(run.id)])
      .then(([graph, ev]) => {
        if (!cancelled) setData({ graph, runtime: ev.state });
      })
      .catch((e) => {
        if (!cancelled) setErr(String((e as Error)?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [run.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sink = data?.graph.nodes.find((n) => n.kind === "sink");

  return (
    <div
      className="gallery-detail"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="gallery-detail__panel run-product-panel"
        role="dialog"
        aria-modal="true"
      >
        <header
          className="gallery-detail__header"
          style={{ borderBottom: "2px solid var(--power)" }}
        >
          <div className="gallery-detail__title">
            <span
              className="gallery-detail__kind"
              style={{ color: "var(--power)", borderColor: "var(--power)" }}
            >
              {t("modals:productGallery.product")}
            </span>
            <span
              className="gallery-detail__name"
              title={run.graph_name || run.id}
            >
              {run.graph_name || t("modals:productGallery.unnamedGraph")}
            </span>
          </div>
          <button
            className="gallery-detail__close icon-btn"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ✕
          </button>
          <div className="gallery-detail__sub">
            <span className={`run-status run-status--${run.status}`}>
              {RUN_STATUS_LABEL[run.status]
                ? t(RUN_STATUS_LABEL[run.status]!)
                : run.status}
            </span>
            <span>·</span>
            <span>{formatShortDateTime(run.started_at)}</span>
            <span>·</span>
            <span>
              {t("modals:productGallery.duration")}{" "}
              {run.ended_at != null
                ? fmtDuration(run.ended_at - run.started_at)
                : t("modals:productGallery.runStatus.running")}
            </span>
            <span>·</span>
            <span>{run.trigger}</span>
          </div>
        </header>
        <div className="gallery-detail__body">
          {err ? (
            <div className="gallery-detail__status gallery-detail__error">
              {t("modals:productGallery.runFailed", { err })}
            </div>
          ) : !data ? (
            <div className="gallery-detail__status">
              {t("modals:productGallery.loading")}
            </div>
          ) : !sink ? (
            <div className="gallery-detail__status">
              {t("modals:productGallery.noSink")}
            </div>
          ) : (
            <FinishedProduct
              sinkId={sink.id}
              graph={data.graph}
              runtime={data.runtime}
            />
          )}
        </div>
      </div>
    </div>
  );
}
