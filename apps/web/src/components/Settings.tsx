import { useEffect, useRef, useState, type DragEvent } from "react";
const STATUS_AUTOHIDE_MS = 2000;
const MODALITY_LABELS: Record<Modality, string> = {
  text: "settings:modelKeys.modality.text",
  image: "settings:modelKeys.modality.image",
  video: "settings:modelKeys.modality.video",
  audio: "settings:modelKeys.modality.audio",
  embedding: "settings:modelKeys.modality.embedding",
};
const MODALITY_OPTIONS = Object.entries(MODALITY_LABELS) as [
  Modality,
  string,
][];
import { api, type AppConfig, type Modality } from "../lib/api";
import {
  PRICING_FIELDS,
  PRICING_HEADING,
  type ModelPricing,
  type PricingField,
} from "@agent-world/core";
import { refreshDefaultModel, useGraph } from "../store/graph";
import type { GraphNode, NodeKind } from "@agent-world/core";
import Tooltip from "./Tooltip";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface TestState {
  status: "idle" | "testing" | "ok" | "fail";
  message?: string;
}

/** A model card flattens provider→model: each row is one model. */
interface ModelCard {
  providerName: string;
  model: string;
}

/** Collect whichever price fields for the modality have a non-empty value. */
function buildPricingFromForm(
  modality: Modality,
  prices: Record<string, string>,
): ModelPricing | undefined {
  const entry: ModelPricing = {};
  for (const field of PRICING_FIELDS[modality]) {
    const raw = prices[field.key];
    if (raw !== undefined && raw !== "") {
      const num = Number(raw);
      if (Number.isFinite(num) && num >= 0) entry[field.key] = num;
    }
  }
  return Object.keys(entry).length > 0 ? entry : undefined;
}

export default function Settings({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<AppConfig | null>(null);
  const [workers, setWorkers] = useState<
    Array<{
      id: string;
      name: string;
      description?: string;
      models?: string[];
      builtin?: boolean;
      isolation?: string;
      env?: string[];
    }>
  >([]);
  const [cardSaved, setCardSaved] = useState<Set<string>>(new Set());
  const [revealKeys, setRevealKeys] = useState<Set<string>>(new Set());
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const dragKeyRef = useRef<string | null>(null);
  const beginDrag = (k: string, e: DragEvent<HTMLElement>) => {
    dragKeyRef.current = k;
    setDragKey(k);
    // Build a fully-opaque drag ghost so the dragged card is clearly visible.
    const source = e.currentTarget.closest(".model-card") as HTMLElement | null;
    if (source) {
      const rect = source.getBoundingClientRect();
      const ghost = source.cloneNode(true) as HTMLElement;
      ghost.style.position = "fixed";
      ghost.style.top = "-10000px";
      ghost.style.left = "-10000px";
      ghost.style.width = `${rect.width}px`;
      ghost.style.opacity = "0.95";
      ghost.style.pointerEvents = "none";
      ghost.style.transform = "rotate(2deg)";
      ghost.style.boxShadow =
        "0 16px 40px rgba(0,0,0,0.6), 0 0 0 1px var(--power)";
      ghost.style.background = "var(--steel-800)";
      ghost.classList.remove("model-card--dragging", "model-card--over");
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 20, 20);
      // Remove after the browser has captured the image.
      setTimeout(() => ghost.remove(), 0);
    }
  };
  const endDrag = () => {
    dragKeyRef.current = null;
    setDragKey(null);
    setOverKey(null);
  };
  const [status, setStatus] = useState<string>("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [workersOpen, setWorkersOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ModelCard | null>(null);
  /** Replacement model chosen in the delete-with-impact dialog. */
  const [deleteReplacement, setDeleteReplacement] = useState<string>("");
  const [newKey, setNewKey] = useState<Record<string, string>>({});
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    model: "",
    providerName: "",
    connectTo: "__new__",
    type: "openai-compatible",
    modality: "text" as Modality,
    baseUrl: "",
    apiKey: "",
    prices: {} as Record<string, string>,
  });
  const [formError, setFormError] = useState("");
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashStatus = (msg: string) => {
    setStatus(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(""), STATUS_AUTOHIDE_MS);
  };

  useEffect(() => {
    if (open) {
      api
        .getSettings()
        .then((cfg) => {
          setConfig(cfg);
          setSavedConfig(cfg);
        })
        .catch((e) =>
          setStatus(t("settings:modelKeys.loadFailed", { error: String(e) })),
        );
      fetch("/api/workers")
        .then((r) => r.json())
        .then((list) => setWorkers(list))
        .catch(() => {});
      setTestStates({});
      setCardSaved(new Set());
      setRevealKeys(new Set());
      dragKeyRef.current = null;
      setDragKey(null);
      setOverKey(null);
      setExpanded(null);
      setAdding(false);
      setForm({
        model: "",
        providerName: "",
        connectTo: "__new__",
        type: "openai-compatible",
        modality: "text",
        baseUrl: "",
        apiKey: "",
        prices: {},
      });
      setFormError("");
    }
  }, [open]);

  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [open, config, savedConfig, newKey]);

  if (!open || !config) return null;

  // Inheriting an existing provider (adding a model under its Base URL + Key)
  // is only allowed for user-created providers — never for builtin tiers like
  // agnes, whose models/Key are product-owned and stripped on save.
  const customProviders = Object.entries(config.providers).filter(
    ([, p]) => p.type !== "fake" && p.source !== "builtin",
  );

  const cardKey = (c: ModelCard) => `${c.providerName}::${c.model}`;

  // Built-in providers (demo fake worker + product-hosted tier) are always
  // surfaced so users see what's available; their per-card delete button is
  // disabled below, matching the read-only "builtin" contract.
  const cards: ModelCard[] = Object.entries(config.providers)
    .filter(([, p]) => p.type !== "fake" || p.source === "builtin")
    .flatMap(([providerName, p]) =>
      p.models.map((model) => ({ providerName, model })),
    );

  const orderIndex = new Map<string, number>();
  (config.modelOrder ?? []).forEach((k, i) => orderIndex.set(k, i));
  cards.sort((a, b) => {
    const ai = orderIndex.get(cardKey(a));
    const bi = orderIndex.get(cardKey(b));
    if (ai === undefined && bi === undefined) return 0;
    if (ai === undefined) return 1;
    if (bi === undefined) return -1;
    return ai - bi;
  });

  const reorderCards = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const keys = cards.map(cardKey);
    const from = keys.indexOf(fromKey);
    const to = keys.indexOf(toKey);
    if (from < 0 || to < 0) return;
    const moving = keys.splice(from, 1)[0]!;
    keys.splice(to, 0, moving);
    // Append any cards missing from the saved order so nothing is lost.
    for (const k of Object.keys(orderIndex))
      if (!keys.includes(k)) keys.push(k);
    setConfig({ ...config, modelOrder: keys });
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => (prev === key ? null : key));
  };

  const patchProvider = (
    name: string,
    patch: Partial<AppConfig["providers"][string]>,
  ) => {
    setConfig({
      ...config,
      providers: {
        ...config.providers,
        [name]: { ...config.providers[name]!, ...patch },
      },
    });
  };

  const setPrice = (
    providerName: string,
    model: string,
    field: keyof ModelPricing,
    value: string,
  ) => {
    const p = config.providers[providerName]!;
    const pricing = { ...(p.pricing ?? {}) };
    const current = pricing[model] ?? {};
    const num = value === "" ? undefined : Number(value);
    pricing[model] = { ...current, [field]: num };
    patchProvider(providerName, { pricing });
  };

  const testConnection = async (c: ModelCard) => {
    const p = config.providers[c.providerName]!;
    const key = cardKey(c);
    const typed = newKey[c.providerName] ?? "";
    // A key is usable if the user typed a fresh one, or state still holds the
    // real key (e.g. just added, not yet re-fetched as redacted). Redacted
    // values (containing * or ...) are never sent — let the server resolve.
    const looksReal = (k: string) =>
      k.length > 0 && !k.includes("*") && !k.includes("...");
    const usableKey = looksReal(typed)
      ? typed
      : looksReal(p.apiKey ?? "")
        ? p.apiKey!
        : "";

    if (!p.baseUrl) {
      setTestStates((s) => ({
        ...s,
        [key]: { status: "fail", message: t("settings:modelKeys.baseUrlRequired") },
      }));
      return;
    }
    if (!usableKey && !p.apiKey) {
      setTestStates((s) => ({
        ...s,
        [key]: { status: "fail", message: t("settings:modelKeys.apiKeyRequired") },
      }));
      return;
    }

    setTestStates((s) => ({ ...s, [key]: { status: "testing" } }));
    try {
      const result = await api.testProvider(
        p.baseUrl!,
        usableKey,
        c.model,
        c.providerName,
        (p.modalities?.[c.model] ?? "text") as Modality,
      );
      if (result.ok) {
        setTestStates((s) => ({
          ...s,
          [key]: { status: "ok", message: t("settings:modelKeys.connectionOk") },
        }));
      } else {
        setTestStates((s) => ({
          ...s,
          [key]: {
            status: "fail",
            message: result.error ?? `HTTP ${result.status}`,
          },
        }));
      }
    } catch (e) {
      setTestStates((s) => ({
        ...s,
        [key]: { status: "fail", message: String(e) },
      }));
    }
  };

  const testFormConnection = async () => {
    const fk = "__form__";
    const model = form.model.trim() || "agnes-2.0-flash";

    // Reusing an existing provider: test its saved connection (server resolves key).
    if (form.connectTo !== "__new__") {
      const owner = config!.providers[form.connectTo];
      if (!owner?.baseUrl) {
        setTestStates((s) => ({
          ...s,
          [fk]: {
            status: "fail",
            message: t("settings:modelKeys.providerNoBaseUrl"),
          },
        }));
        return;
      }
      setTestStates((s) => ({ ...s, [fk]: { status: "testing" } }));
      try {
        const result = await api.testProvider(
          owner.baseUrl,
          "",
          model,
          form.connectTo,
          form.modality,
        );
        if (result.ok) {
          setTestStates((s) => ({
            ...s,
            [fk]: { status: "ok", message: t("settings:modelKeys.connectionOk") },
          }));
        } else {
          setTestStates((s) => ({
            ...s,
            [fk]: {
              status: "fail",
              message: result.error ?? `HTTP ${result.status}`,
            },
          }));
        }
      } catch (e) {
        setTestStates((s) => ({
          ...s,
          [fk]: { status: "fail", message: String(e) },
        }));
      }
      return;
    }

    // New provider: test the values typed in the form.
    const baseUrl = form.baseUrl.trim();
    const apiKey = form.apiKey.trim();

    if (!baseUrl) {
      setTestStates((s) => ({
        ...s,
        [fk]: { status: "fail", message: t("settings:modelKeys.baseUrlRequired") },
      }));
      return;
    }
    if (!apiKey) {
      setTestStates((s) => ({
        ...s,
        [fk]: { status: "fail", message: t("settings:modelKeys.apiKeyRequired") },
      }));
      return;
    }

    setTestStates((s) => ({ ...s, [fk]: { status: "testing" } }));
    try {
      const result = await api.testProvider(
        baseUrl,
        apiKey,
        model,
        undefined,
        form.modality,
      );
      if (result.ok) {
        setTestStates((s) => ({
          ...s,
          [fk]: { status: "ok", message: t("settings:modelKeys.connectionOk") },
        }));
      } else {
        setTestStates((s) => ({
          ...s,
          [fk]: {
            status: "fail",
            message: result.error ?? `HTTP ${result.status}`,
          },
        }));
      }
    } catch (e) {
      setTestStates((s) => ({
        ...s,
        [fk]: { status: "fail", message: String(e) },
      }));
    }
  };

  const startAdd = () => {
    const firstProvider = customProviders[0]?.[0];
    setForm({
      model: "",
      providerName: "",
      connectTo: firstProvider ?? "__new__",
      type: "openai-compatible",
      modality: "text",
      baseUrl: "",
      apiKey: "",
      prices: {},
    });
    setFormError("");
    setExpanded(null);
    setAdding(true);
  };

  const addModel = () => {
    const name = form.model.trim();
    if (!name) {
      setFormError(t("settings:modelKeys.modelNameRequired"));
      return;
    }
    const ci = (s: string) => s.toLowerCase();
    const priceEntry = buildPricingFromForm(form.modality, form.prices);

    if (form.connectTo !== "__new__") {
      const owner = config.providers[form.connectTo];
      if (!owner) {
        setFormError(t("settings:modelKeys.providerNotFound"));
        return;
      }
      if (owner.models.some((m) => ci(m) === ci(name))) {
        setFormError(t("settings:modelKeys.modelExists", { model: name }));
        return;
      }
      const pricing = { ...(owner.pricing ?? {}) };
      if (priceEntry) pricing[name] = priceEntry;
      const modalities = { ...(owner.modalities ?? {}), [name]: form.modality };
      setConfig({
        ...config,
        providers: {
          ...config.providers,
          [form.connectTo]: {
            ...owner,
            models: [...owner.models, name],
            modalities,
            ...(priceEntry ? { pricing } : {}),
          },
        },
        modelOrder: [
          ...(config.modelOrder ?? []),
          `${form.connectTo}::${name}`,
        ],
      });
    } else {
      if (form.type === "openai-compatible" && !form.baseUrl.trim()) {
        setFormError(t("settings:modelKeys.baseUrlRequiredNew"));
        return;
      }
      const slug = providerSlug;
      if (providerExists) {
        setFormError(
          t("settings:modelKeys.providerNameExists", { slug }),
        );
        return;
      }
      const pricing: Record<string, ModelPricing> = {};
      if (priceEntry) pricing[name] = priceEntry;
      setConfig({
        ...config,
        providers: {
          ...config.providers,
          [slug]: {
            type: form.type as AppConfig["providers"][string]["type"],
            baseUrl: form.baseUrl.trim() || undefined,
            apiKey: form.apiKey.trim() || undefined,
            models: [name],
            enabled: true,
            modalities: { [name]: form.modality },
            ...(Object.keys(pricing).length > 0 ? { pricing } : {}),
          },
        },
        modelOrder: [...(config.modelOrder ?? []), `${slug}::${name}`],
      });
    }

    setForm({
      model: "",
      providerName: "",
      connectTo: "__new__",
      type: "openai-compatible",
      modality: "text",
      baseUrl: "",
      apiKey: "",
      prices: {},
    });
    setFormError("");
    setAdding(false);
    setStatus("");
  };

  const removeCard = (c: ModelCard) => {
    const p = config.providers[c.providerName]!;
    const remainingModels = p.models.filter((m) => m !== c.model);
    const nextProviders = { ...config.providers };
    if (remainingModels.length === 0) {
      delete nextProviders[c.providerName];
    } else {
      nextProviders[c.providerName] = { ...p, models: remainingModels };
    }
    let nextDefault = config.defaultModel;
    let nextDefaultProvider = config.defaultProvider;
    const removingDefault =
      config.defaultModel === c.model &&
      config.defaultProvider === c.providerName;
    if (removingDefault) {
      // Pick the first remaining enabled model, provider-aware.
      const first = Object.entries(nextProviders)
        .filter(([, pp]) => pp.type !== "fake" && pp.enabled !== false)
        .flatMap(([pname, pp]) =>
          pp.models.map((m) => ({ model: m, provider: pname })),
        )[0];
      nextDefault = first?.model ?? "fake";
      nextDefaultProvider = first?.provider ?? "fake";
    } else if (
      config.defaultProvider === c.providerName &&
      !(c.providerName in nextProviders)
    ) {
      nextDefaultProvider =
        Object.keys(nextProviders).find((k) => k !== "fake") ?? "fake";
    }
    setConfig({
      ...config,
      defaultModel: nextDefault,
      defaultProvider: nextDefaultProvider,
      providers: nextProviders,
      modelOrder: (config.modelOrder ?? []).filter((k) => k !== cardKey(c)),
    });
    const keyCopy = { ...newKey };
    delete keyCopy[c.providerName];
    setNewKey(keyCopy);
  };

  /** All nodes currently using a given model. The Settings only sees the
   *  open graph, so this naturally scopes to the active line; switching
   *  graphs while the dialog is open re-runs the lookup. */
  const nodesUsingModel = (
    providerName: string,
    modelName: string,
  ): GraphNode[] => {
    const nodes = useGraph.getState().graph.nodes;
    return nodes.filter((n) => {
      const cfg =
        n.kind === "textGen"
          ? n.textGen
          : n.kind === "imageGen"
            ? n.imageGen
            : n.kind === "videoGen"
              ? n.videoGen
              : n.kind === "audioGen"
                ? n.audioGen
                : null;
      return cfg?.model === modelName;
    });
  };

  /** Same-modality candidate models for the replacement dropdown, excluding
   *  the model being deleted. The deletion's own provider entry is filtered
   *  by the caller so the user can pick across providers. */
  const replacementCandidates = (
    providerName: string,
    modelName: string,
    modality: Modality | null,
  ): Array<{ provider: string; model: string }> => {
    if (!modality) return [];
    const out: Array<{ provider: string; model: string }> = [];
    for (const [pname, p] of Object.entries(config.providers)) {
      if (p.enabled === false) continue;
      const mod =
        (p as { modalities?: Record<string, Modality> }).modalities ?? {};
      for (const m of p.models) {
        if (m === modelName && pname === providerName) continue;
        if ((mod[m] ?? "text") !== modality) continue;
        out.push({ provider: pname, model: m });
      }
    }
    return out;
  };

  /** Whether a node kind carries a model field and what modality it needs. */
  const kindModality = (kind: NodeKind): Modality | null => {
    if (kind === "textGen") return "text";
    if (kind === "imageGen") return "image";
    if (kind === "videoGen") return "video";
    if (kind === "audioGen") return "audio";
    return null;
  };

  /** Apply a model replacement to one node. */
  const applyModelReplacement = (
    nodeId: string,
    kind: NodeKind,
    newModel: string,
  ) => {
    const update = useGraph.getState().updateNode;
    if (kind === "textGen") {
      update(nodeId, {
        textGen: {
          model: newModel,
          prompt: "",
          skills: [],
          temperature: 0.7,
          timeoutMs: 120000,
          inputPolicy: { mode: "all" },
          retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 },
        },
      });
    } else if (kind === "imageGen") {
      update(nodeId, { imageGen: { model: newModel, n: 1 } });
    } else if (kind === "videoGen") {
      update(nodeId, { videoGen: { model: newModel, n: 1 } });
    } else if (kind === "audioGen") {
      update(nodeId, { audioGen: { model: newModel, format: "mp3", n: 1 } });
    }
  };

  const setDefault = (c: ModelCard) => {
    setConfig({
      ...config,
      defaultModel: c.model,
      defaultProvider: c.providerName,
    });
  };

  /** Drop the injected built-in tier (product-owned providers) so per-user
   *  config never persists or diffs against them. The built-in tier is
   *  always re-injected from DEFAULT_CONFIG on load. */
  const stripBuiltin = (c: AppConfig): AppConfig => ({
    ...c,
    providers: Object.fromEntries(
      Object.entries(c.providers).filter(([, p]) => p.source !== "builtin"),
    ),
  });

  const buildPersistConfig = (): AppConfig =>
    stripBuiltin({
      ...config,
      providers: Object.fromEntries(
        Object.entries(config.providers).map(([name, p]) => [
          name,
          newKey[name] ? { ...p, apiKey: newKey[name] } : p,
        ]),
      ),
    });

  const isDirty = (): boolean => {
    if (!config || !savedConfig) return false;
    return (
      JSON.stringify(buildPersistConfig()) !==
      JSON.stringify(stripBuiltin(savedConfig))
    );
  };

  const requestClose = () => {
    if (isDirty()) setConfirmClose(true);
    else onClose();
  };

  const saveAndClose = async () => {
    const toSave = buildPersistConfig();
    try {
      await api.saveSettings(toSave);
      setSavedConfig(toSave);
      void refreshDefaultModel();
      setNewKey({});
      setConfirmClose(false);
      onClose();
    } catch (e) {
      setStatus(t("settings:modelKeys.saveFailed", { error: String(e) }));
    }
  };

  const discardAndClose = () => {
    setConfirmClose(false);
    onClose();
  };

  const updateCard = async (c: ModelCard) => {
    const toSave = buildPersistConfig();
    try {
      await api.saveSettings(toSave);
      setSavedConfig(toSave);
      void refreshDefaultModel();
      setCardSaved((prev) => new Set(prev).add(cardKey(c)));
      const keyCopy = { ...newKey };
      delete keyCopy[c.providerName];
      setNewKey(keyCopy);
      setStatus("");
      setTimeout(() => {
        setCardSaved((prev) => {
          const next = new Set(prev);
          next.delete(cardKey(c));
          return next;
        });
      }, 1500);
    } catch (e) {
      setStatus(t("settings:modelKeys.saveFailed", { error: String(e) }));
    }
  };

  const revertCard = (c: ModelCard) => {
    if (!savedConfig) return;
    const original = savedConfig.providers[c.providerName];
    if (!original) {
      removeCard(c);
      return;
    }
    patchProvider(c.providerName, original);
    const keyCopy = { ...newKey };
    delete keyCopy[c.providerName];
    setNewKey(keyCopy);
    setTestStates((s) => {
      const next = { ...s };
      delete next[cardKey(c)];
      return next;
    });
  };

  const isShowableKey = (k: string | undefined): k is string =>
    !!k && k.length > 0 && !k.includes("*") && !k.includes("...");

  const toggleReveal = (id: string) => {
    const revealed = revealKeys.has(id);
    setRevealKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // When revealing a card that still holds a real key in state (newly added),
    // copy it into the input so the user can actually see/edit it.
    if (!revealed && id !== "__form__") {
      const prov = config?.providers[id];
      if (prov && isShowableKey(prov.apiKey) && !newKey[id]) {
        setNewKey((prev) => ({ ...prev, [id]: prov.apiKey! }));
      }
    }
  };

  const providerSlug = (form.providerName.trim() || form.model.trim())
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
  const providerExists =
    form.connectTo === "__new__" &&
    providerSlug.length > 0 &&
    Object.prototype.hasOwnProperty.call(config.providers, providerSlug);

  const save = async () => {
    const toSave = buildPersistConfig();
    try {
      await api.saveSettings(toSave);
      setSavedConfig(toSave);
      setNewKey({});
      void refreshDefaultModel();
      flashStatus(t("settings:modelKeys.saved"));
      setTimeout(onClose, 800);
    } catch (e) {
      setStatus(t("settings:modelKeys.saveFailed", { error: String(e) }));
    }
  };

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("settings:modelKeys.title")}</h2>
          <button className="link" onClick={requestClose}>
            {t("settings:modelKeys.close")}
          </button>
        </div>

        <div className="modal__body">
          <div className="settings-section-head">
            <h3 className="label">{t("settings:modelKeys.models")}</h3>
            <button
              className="btn btn--ghost btn--icon"
              onClick={() => (adding ? setAdding(false) : startAdd())}
            >
              {adding ? "×" : "+"}
            </button>
          </div>

          {adding && (
            <div className="model-form">
              <label className="field">
                <span>{t("settings:modelKeys.modelName")}</span>
                <input
                  autoFocus
                  placeholder={t("settings:modelKeys.modelNamePlaceholder")}
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{t("settings:modelKeys.modalityLabel")}</span>
                <select
                  className="select"
                  value={form.modality}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      modality: e.target.value as Modality,
                      prices: {},
                    })
                  }
                >
                  {MODALITY_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {t(label)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("settings:modelKeys.provider")}</span>
                <select
                  className="select"
                  value={form.connectTo}
                  onChange={(e) =>
                    setForm({ ...form, connectTo: e.target.value })
                  }
                >
                  {customProviders.length === 0 && (
                    <option value="__new__">
                      {t("settings:modelKeys.newProvider")}
                    </option>
                  )}
                  {customProviders.map(([pname, pp]) => (
                    <option key={pname} value={pname}>
                      {pname} — {pp.baseUrl ?? t("settings:modelKeys.noUrl")}
                    </option>
                  ))}
                  <option value="__new__">
                    {t("settings:modelKeys.newProviderEllipsis")}
                  </option>
                </select>
              </label>

              {form.connectTo !== "__new__" ? (
                <p className="diag diag--ok form-hint">
                  {t("settings:modelKeys.reuseHint", {
                    provider: form.connectTo,
                  })}
                </p>
              ) : (
                <>
                  <label className="field">
                    <span>{t("settings:modelKeys.providerNameLabel")}</span>
                    <input
                      className={providerExists ? "input--error" : undefined}
                      placeholder={t("settings:modelKeys.providerNamePlaceholder")}
                      value={form.providerName}
                      onChange={(e) => {
                        setForm({ ...form, providerName: e.target.value });
                        if (formError) setFormError("");
                      }}
                    />
                    {providerExists ? (
                      <span className="field__error">
                        {t("settings:modelKeys.providerExists", {
                          slug: providerSlug,
                        })}
                      </span>
                    ) : form.providerName.trim() ? (
                      <span className="field__hint">
                        {t("settings:modelKeys.willSaveAs", { slug: providerSlug })}
                      </span>
                    ) : null}
                  </label>
                  <label className="field">
                    <span>{t("settings:modelKeys.providerType")}</span>
                    <select
                      className="select"
                      value={form.type}
                      onChange={(e) =>
                        setForm({ ...form, type: e.target.value })
                      }
                    >
                      <option value="openai-compatible">
                        openai-compatible
                      </option>
                      <option value="anthropic" disabled>
                        {t("settings:modelKeys.anthropicSoon")}
                      </option>
                    </select>
                  </label>
                  <label className="field">
                    <span>{t("settings:modelKeys.baseUrl")}</span>
                    <input
                      placeholder="https://api.example.com/v1"
                      value={form.baseUrl}
                      onChange={(e) =>
                        setForm({ ...form, baseUrl: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("settings:modelKeys.apiKey")}</span>
                    <div className="key-input">
                      <input
                        type="text"
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-form-type="other"
                        className={
                          revealKeys.has("__form__") ? "" : "key-input__masked"
                        }
                        placeholder="sk-..."
                        value={form.apiKey}
                        onChange={(e) =>
                          setForm({ ...form, apiKey: e.target.value })
                        }
                      />
                      <button
                        type="button"
                        className="link link--sm key-input__toggle"
                        onClick={() => toggleReveal("__form__")}
                        tabIndex={-1}
                      >
                        {revealKeys.has("__form__")
                          ? t("settings:modelKeys.hide")
                          : t("settings:modelKeys.show")}
                      </button>
                    </div>
                  </label>
                </>
              )}
              <div className="field">
                <span>{PRICING_HEADING[form.modality]}</span>
                <div className="price-row">
                  <code className="price-name">
                    {form.model || t("settings:modelKeys.modelPlaceholder")}
                  </code>
                  {PRICING_FIELDS[form.modality].map((field) => (
                    <input
                      key={field.key}
                      type="number"
                      step={field.step ?? "0.01"}
                      min="0"
                      placeholder={`${field.label} ${field.unit}`}
                      value={form.prices[field.key] ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          prices: {
                            ...form.prices,
                            [field.key]: e.target.value,
                          },
                        })
                      }
                    />
                  ))}
                </div>
              </div>
              {formError && <p className="diag diag--error">{formError}</p>}
              {(testStates["__form__"]?.status === "ok" ||
                testStates["__form__"]?.status === "fail") && (
                <p
                  className={`diag ${
                    testStates["__form__"]?.status === "ok"
                      ? "diag--ok"
                      : "diag--error"
                  }`}
                >
                  {testStates["__form__"]!.message}
                </p>
              )}
              <div className="model-form__actions">
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={testFormConnection}
                  disabled={testStates["__form__"]?.status === "testing"}
                >
                  {testStates["__form__"]?.status === "testing"
                    ? t("settings:modelKeys.testing")
                    : t("settings:modelKeys.test")}
                </button>
                <div className="model-form__actions-right">
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      setAdding(false);
                      setFormError("");
                    }}
                  >
                    {t("settings:modelKeys.cancel")}
                  </button>
                  <button className="btn btn--sm" onClick={addModel}>
                    {t("settings:modelKeys.addModel")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {cards.length === 0 && !adding && (
            <p className="muted settings-empty">{t("settings:modelKeys.empty")}</p>
          )}

          {cards.map((c) => {
            const p = config.providers[c.providerName]!;
            const key = cardKey(c);
            const isOpen = expanded === key;
            const isEnabled = p.enabled !== false;
            const ts = testStates[key];
            const isDefault =
              config.defaultModel === c.model &&
              config.defaultProvider === c.providerName;

            return (
              <div
                key={key}
                className={`model-card ${!isEnabled ? "model-card--disabled" : ""} ${
                  isOpen ? "model-card--open" : ""
                } ${dragKey === key ? "model-card--dragging" : ""} ${
                  overKey === key && dragKey && dragKey !== key
                    ? "model-card--over"
                    : ""
                }`}
                onDragOver={(e) => {
                  if (dragKeyRef.current && dragKeyRef.current !== key) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overKey !== key) setOverKey(key);
                  }
                }}
                onDragEnter={(e) => {
                  if (dragKeyRef.current && dragKeyRef.current !== key) {
                    e.preventDefault();
                    setOverKey(key);
                  }
                }}
                onDragLeave={(e) => {
                  // Only clear when leaving the card entirely (not moving to a child).
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setOverKey((cur) => (cur === key ? null : cur));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragKeyRef.current;
                  endDrag();
                  if (from && from !== key) reorderCards(from, key);
                }}
              >
                <div
                  className="model-card__head"
                  onClick={() => toggleExpand(key)}
                >
                  <span
                    className="model-card__grip"
                    draggable
                    onClick={(e) => e.stopPropagation()}
                    onDragStart={(e) => {
                      beginDrag(key, e);
                      e.dataTransfer.effectAllowed = "move";
                      try {
                        e.dataTransfer.setData("text/plain", key);
                      } catch {}
                    }}
                    onDragEnd={endDrag}
                  >
                    ⠿
                  </span>
                  <span className="model-card__chevron">
                    {isOpen ? "▼" : "▶"}
                  </span>
                  <label
                    className="toggle"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(e) =>
                        patchProvider(c.providerName, {
                          enabled: e.target.checked,
                        })
                      }
                    />
                  </label>
                  <code className="model-card__name">{c.model}</code>
                  <span className="muted model-card__provider">
                    {c.providerName}
                  </span>
                  <span
                    className={`modality-badge modality--${p.modalities?.[c.model] ?? "text"}`}
                  >
                    {t(
                      MODALITY_LABELS[
                        (p.modalities?.[c.model] ?? "text") as Modality
                      ],
                    )}
                  </span>
                  {p.source === "builtin" && (
                    <Tooltip content={t("settings:modelKeys.builtinTooltip")}>
                      <span className="badge badge--builtin">
                        {t("settings:modelKeys.builtin")}
                      </span>
                    </Tooltip>
                  )}
                  {isDefault && (
                    <span className="badge badge--default">
                      {t("settings:modelKeys.default")}
                    </span>
                  )}
                  <div
                    className="model-card__head-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!isDefault && (
                      <button
                        className="link link--sm"
                        onClick={() => setDefault(c)}
                      >
                        {t("settings:modelKeys.setDefault")}
                      </button>
                    )}
                    {p.source !== "builtin" && (
                      <button
                        className="link link--sm link--danger"
                        onClick={() => {
                          setDeleteTarget(c);
                          // Pre-seed the replacement dropdown with the first
                          // same-modality candidate so the dialog is one
                          // click away from confirming when there is one.
                          const prov = config.providers[c.providerName];
                          const mod = prov?.modalities?.[c.model] as
                            Modality | undefined;
                          const candidates = replacementCandidates(
                            c.providerName,
                            c.model,
                            mod ?? null,
                          );
                          setDeleteReplacement(candidates[0]?.model ?? "");
                        }}
                      >
                        {t("settings:modelKeys.delete")}
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="model-card__body">
                    <label className="field">
                      <span>{t("settings:modelKeys.modalityLabel")}</span>
                      <select
                        className="select"
                        disabled
                        value={p.modalities?.[c.model] ?? "text"}
                      >
                        {MODALITY_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>{t("settings:modelKeys.providerType")}</span>
                      <select className="select" disabled value={p.type}>
                        <option value="openai-compatible">
                          openai-compatible
                        </option>
                        <option value="anthropic" disabled>
                          {t("settings:modelKeys.anthropicSoon")}
                        </option>
                        <option value="fake">
                          {t("settings:modelKeys.fakeBuiltin")}
                        </option>
                      </select>
                    </label>
                    <label className="field">
                      <span>{t("settings:modelKeys.baseUrl")}</span>
                      <input
                        disabled
                        value={p.baseUrl ?? ""}
                        placeholder="https://api.example.com/v1"
                      />
                    </label>
                    <label className="field">
                      <span>{t("settings:modelKeys.apiKey")}</span>
                      <div className="key-input">
                        <input
                          type="text"
                          autoComplete="off"
                          data-lpignore="true"
                          data-1p-ignore="true"
                          data-form-type="other"
                          disabled={p.source === "builtin"}
                          className={
                            revealKeys.has(c.providerName)
                              ? ""
                              : "key-input__masked"
                          }
                          placeholder={
                            p.source === "builtin"
                              ? p.apiKey
                                ? t("settings:modelKeys.builtinKeyReadonly")
                                : t("settings:modelKeys.builtinNoKey")
                              : p.apiKey
                                ? t("settings:modelKeys.keyConfigured")
                                : t("settings:modelKeys.keyNotConfigured")
                          }
                          value={newKey[c.providerName] ?? ""}
                          onChange={(e) =>
                            setNewKey({
                              ...newKey,
                              [c.providerName]: e.target.value,
                            })
                          }
                        />
                        <button
                          type="button"
                          className="link link--sm key-input__toggle"
                          onClick={() => toggleReveal(c.providerName)}
                          tabIndex={-1}
                        >
                          {revealKeys.has(c.providerName)
                            ? t("settings:modelKeys.hide")
                            : t("settings:modelKeys.show")}
                        </button>
                      </div>
                    </label>
                    <div className="field">
                      <span>
                        {
                          PRICING_HEADING[
                            (p.modalities?.[c.model] ?? "text") as Modality
                          ]
                        }
                      </span>
                      <div className="price-row">
                        <code className="price-name">{c.model}</code>
                        {PRICING_FIELDS[
                          (p.modalities?.[c.model] ?? "text") as Modality
                        ].map((field) => (
                          <input
                            key={field.key}
                            type="number"
                            step={field.step ?? "0.01"}
                            min="0"
                            disabled={p.source === "builtin"}
                            placeholder={`${field.label} ${field.unit}`}
                            value={p.pricing?.[c.model]?.[field.key] ?? ""}
                            onChange={(e) =>
                              setPrice(
                                c.providerName,
                                c.model,
                                field.key,
                                e.target.value,
                              )
                            }
                          />
                        ))}
                      </div>
                    </div>
                    <div className="provider-card__actions">
                      {p.source !== "builtin" && (
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => testConnection(c)}
                          disabled={ts?.status === "testing"}
                        >
                          {ts?.status === "testing"
                            ? t("settings:modelKeys.testing")
                            : t("settings:modelKeys.test")}
                        </button>
                      )}
                      {ts?.status === "ok" && (
                        <span className="diag diag--ok">{ts.message}</span>
                      )}
                      {ts?.status === "fail" && (
                        <span className="diag diag--error">{ts.message}</span>
                      )}
                    </div>
                    {p.source !== "builtin" && (
                      <div className="model-card__footer-actions">
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => revertCard(c)}
                        >
                          {t("settings:modelKeys.revert")}
                        </button>
                        <button
                          className="btn btn--sm"
                          onClick={() => updateCard(c)}
                        >
                          {cardSaved.has(key)
                            ? t("settings:modelKeys.updated")
                            : t("settings:modelKeys.update")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="settings-section-head">
            <h3 className="label">{t("settings:modelKeys.monthlyBudget")}</h3>
          </div>
          <label className="field">
            <span>{t("settings:modelKeys.monthlySoftCap")}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder={t("settings:modelKeys.monthlyCapPlaceholder")}
              value={config.monthlyBudgetUsd ?? ""}
              onChange={(e) =>
                setConfig({
                  ...config,
                  monthlyBudgetUsd:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
            <small className="muted">{t("settings:modelKeys.monthlyCapHint")}</small>
          </label>

          <div className="settings-section-head">
            <h3 className="label">{t("settings:search.title")}</h3>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            {t("settings:search.description")}
          </p>
          <label className="field">
            <span>{t("settings:search.provider")}</span>
            <select
              value={config.searchConfig?.provider ?? ""}
              onChange={(e) =>
                setConfig({
                  ...config,
                  searchConfig: {
                    ...(config.searchConfig ?? {}),
                    provider: e.target.value || undefined,
                  },
                })
              }
            >
              <option value="">{t("settings:search.providerDuckduckgo")}</option>
              <option value="tavily">{t("settings:search.providerTavily")}</option>
              <option value="serpapi">{t("settings:search.providerSerpapi")}</option>
              <option value="google">{t("settings:search.providerGoogle")}</option>
            </select>
          </label>
          {(config.searchConfig?.provider ?? "") !== "" && (
            <>
              <label className="field">
                <span>{t("settings:search.apiKey")}</span>
                <input
                  type="text"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  placeholder={t("settings:search.apiKeyPlaceholder")}
                  value={config.searchConfig?.apiKey ?? ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      searchConfig: {
                        ...(config.searchConfig ?? {}),
                        apiKey: e.target.value || undefined,
                      },
                    })
                  }
                />
              </label>
              {config.searchConfig?.provider === "google" && (
                <label className="field">
                  <span>{t("settings:search.cx")}</span>
                  <input
                    placeholder="0123456789abcdef:xyz"
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    value={config.searchConfig?.cx ?? ""}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        searchConfig: {
                          ...(config.searchConfig ?? {}),
                          cx: e.target.value || undefined,
                        },
                      })
                    }
                  />
                  <small className="muted">{t("settings:search.cxDescription")}</small>
                </label>
              )}
              <small className="muted">{t("settings:search.note")}</small>
            </>
          )}

          <button
            type="button"
            className="settings-section-head settings-section-head--clickable"
            onClick={() => setWorkersOpen((v) => !v)}
            aria-expanded={workersOpen}
          >
            <h3 className="label">{t("settings:modelKeys.workers")}</h3>
            <span className={`chevron ${workersOpen ? "chevron--open" : ""}`}>
              ▸
            </span>
          </button>
          {workersOpen && (
            <>
              <div className="worker-list">
                {workers.map((w) => (
                  <div key={w.id} className="worker-item">
                    <div className="worker-item__head">
                      <span className="worker-item__name">{w.name}</span>
                      <span
                        className={`chip chip--${w.isolation === "subprocess" ? "warn" : "ok"}`}
                      >
                        {w.isolation === "subprocess"
                          ? t("settings:modelKeys.subprocessIsolation")
                          : t("settings:modelKeys.inProcess")}
                      </span>
                      {w.builtin && (
                        <span className="chip chip--muted">
                          {t("settings:modelKeys.builtin")}
                        </span>
                      )}
                    </div>
                    {w.description && (
                      <p className="worker-item__desc muted">{w.description}</p>
                    )}
                    {w.models && w.models.length > 0 && (
                      <p className="worker-item__models muted">
                        {t("settings:modelKeys.modelsList", {
                          models: w.models.join(", "),
                        })}
                      </p>
                    )}
                    {w.env && w.env.length > 0 && (
                      <p className="worker-item__env muted">
                        {t("settings:modelKeys.allowedEnv", {
                          env: w.env.join(", "),
                        })}
                      </p>
                    )}
                  </div>
                ))}
                {workers.length === 0 && (
                  <p className="muted">{t("settings:modelKeys.noWorkers")}</p>
                )}
              </div>
              <p
                className="muted"
                style={{ fontSize: "12px", marginTop: "8px" }}
              >
                {t("settings:modelKeys.workersHint")}
              </p>
            </>
          )}

          {status && <p className="diag diag--ok">{status}</p>}
        </div>

        {deleteTarget &&
          (() => {
            const affected = nodesUsingModel(
              deleteTarget.providerName,
              deleteTarget.model,
            );
            const prov = config.providers[deleteTarget.providerName];
            const mod = prov?.modalities?.[deleteTarget.model] as
              Modality | undefined;
            const candidates = replacementCandidates(
              deleteTarget.providerName,
              deleteTarget.model,
              mod ?? null,
            );
            if (affected.length === 0) {
              return (
                <div
                  className="modal-confirm modal-confirm--danger"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="modal-confirm__title">
                    {t("settings:modelKeys.deleteModel")}
                  </p>
                  <p className="modal-confirm__desc">
                    {t("settings:modelKeys.deleteConfirm", {
                      model: deleteTarget.model,
                    })}
                    <br />
                    {t("settings:modelKeys.belongsTo")}
                    <code>{deleteTarget.providerName}</code>
                    {prov && prov.models.length === 1
                      ? t("settings:modelKeys.deleteLastModelNote")
                      : ""}
                  </p>
                  <div className="modal-confirm__actions">
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => setDeleteTarget(null)}
                    >
                      {t("settings:modelKeys.cancel")}
                    </button>
                    <button
                      className="btn btn--sm btn--danger"
                      onClick={() => {
                        removeCard(deleteTarget);
                        setDeleteTarget(null);
                      }}
                    >
                      {t("settings:modelKeys.delete")}
                    </button>
                  </div>
                </div>
              );
            }
            // Group affected nodes by kind so the dialog reads naturally even
            // when the user is using a single model across many node kinds.
            const groups = new Map<NodeKind, GraphNode[]>();
            for (const n of affected) {
              const list = groups.get(n.kind) ?? [];
              list.push(n);
              groups.set(n.kind, list);
            }
            return (
              <div
                className="modal-confirm modal-confirm--danger"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="modal-confirm__title">
                  {t("settings:modelKeys.deleteAffects", {
                    n: affected.length,
                  })}
                </p>
                <p className="modal-confirm__desc">
                  {t("settings:modelKeys.deleteAffectsDesc", {
                    model: deleteTarget.model,
                    modality: t(MODALITY_LABELS[mod ?? "text"]),
                  })}
                </p>
                <ul className="modal-confirm__list">
                  {[...groups.entries()].map(([kind, list]) => (
                    <li key={kind}>
                      <span className="modal-confirm__list-kind">
                        {t(MODALITY_LABELS[kindModality(kind) ?? "text"])}
                      </span>
                      <span>
                        {t("settings:modelKeys.nodesCount", { n: list.length })}
                        {list
                          .slice(0, 4)
                          .map((n) => n.name)
                          .join("、")}
                        {list.length > 4 ? ` … +${list.length - 4}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <label className="field modal-confirm__field">
                  <span>{t("settings:modelKeys.replaceWith")}</span>
                  <select
                    className="select"
                    value={deleteReplacement}
                    onChange={(e) => setDeleteReplacement(e.target.value)}
                  >
                    {candidates.length === 0 && (
                      <option value="" disabled>
                        {t("settings:modelKeys.noSameModality")}
                      </option>
                    )}
                    {candidates.map((c) => (
                      <option key={`${c.provider}::${c.model}`} value={c.model}>
                        {c.model} · {c.provider}
                      </option>
                    ))}
                  </select>
                </label>
                {candidates.length === 0 && (
                  <p className="diag diag--warn">
                    {t("settings:modelKeys.noSameModalityWarn")}
                  </p>
                )}
                <div className="modal-confirm__actions">
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      setDeleteTarget(null);
                      setDeleteReplacement("");
                    }}
                  >
                    {t("settings:modelKeys.cancel")}
                  </button>
                  <button
                    className="btn btn--sm btn--danger"
                    disabled={candidates.length > 0 && !deleteReplacement}
                    onClick={() => {
                      // Apply the chosen replacement to every affected node,
                      // then drop the deleted model from the provider config.
                      if (deleteReplacement) {
                        for (const n of affected) {
                          applyModelReplacement(
                            n.id,
                            n.kind,
                            deleteReplacement,
                          );
                        }
                      } else {
                        for (const n of affected) {
                          applyModelReplacement(n.id, n.kind, "");
                        }
                      }
                      removeCard(deleteTarget);
                      setDeleteTarget(null);
                      setDeleteReplacement("");
                    }}
                  >
                    {candidates.length > 0
                      ? t("settings:modelKeys.confirmReplaceDelete")
                      : t("settings:modelKeys.confirmClearDelete")}
                  </button>
                </div>
              </div>
            );
          })()}

        {confirmClose && (
          <div className="modal-confirm" onClick={(e) => e.stopPropagation()}>
            <p className="modal-confirm__title">
              {t("settings:modelKeys.unsavedTitle")}
            </p>
            <p className="modal-confirm__desc">
              {t("settings:modelKeys.unsavedDesc")}
            </p>
            <div className="modal-confirm__actions">
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => setConfirmClose(false)}
              >
                {t("settings:modelKeys.keepEditing")}
              </button>
              <button
                className="btn btn--ghost btn--sm"
                onClick={discardAndClose}
              >
                {t("settings:modelKeys.discard")}
              </button>
              <button className="btn btn--sm" onClick={saveAndClose}>
                {t("settings:modelKeys.saveAndClose")}
              </button>
            </div>
          </div>
        )}

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={requestClose}>
            {t("settings:modelKeys.cancel")}
          </button>
          <button className="btn" onClick={save}>
            {t("settings:modelKeys.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
