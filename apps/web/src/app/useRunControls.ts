/** Run-control half of the app shell (audit P2 follow-up split out of
 * App.tsx): the control-panel inputs, the debounced compile diagnostics, the
 * form-connector field collection and the run/cancel handlers. The hook
 * subscribes to the same graph/run stores App.tsx did, so the save-then-start
 * sequence and the 402 upgrade gate are unchanged.
 */
import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { Diagnostic, FormConnector } from "@agent-world/core";
import type { Mode } from "../canvas/Canvas";
import { api } from "../lib/api";
import { useToast } from "../store/toast";
import { parseQuotaError, useUpgradeGate } from "../store/upgrade-gate";
import { useGraph } from "../store/graph";
import { useRun } from "../store/run";

type FormField = FormConnector["fields"][number];

const showError = (msg: string) => {
  useToast.getState().show(msg, { ttlMs: 6000 });
};

export interface RunControls {
  mode: Mode;
  setMode: Dispatch<SetStateAction<Mode>>;
  budget: number;
  setBudget: Dispatch<SetStateAction<number>>;
  rawMaterial: string;
  setRawMaterial: Dispatch<SetStateAction<string>>;
  diagnostics: Diagnostic[];
  canRun: boolean;
  formFields: FormField[] | null;
  setFormFields: Dispatch<SetStateAction<FormField[] | null>>;
  onRun: () => void;
  onFormSubmit: (values: Record<string, string>) => void;
  onCancel: () => Promise<void>;
}

export function useRunControls(): RunControls {
  const { t } = useTranslation();
  const graph = useGraph((s) => s.graph);
  const flushSave = useGraph((s) => s.flushSave);
  const connect = useRun((s) => s.connect);
  const reset = useRun((s) => s.reset);
  const runId = useRun((s) => s.runId);

  const [mode, setMode] = useState<Mode>("select");
  const [budget, setBudget] = useState(0.01);
  const [rawMaterial, setRawMaterial] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [canRun, setCanRun] = useState(false);
  const [formFields, setFormFields] = useState<FormField[] | null>(null);

  // The compiler is dependency-free, so diagnostics could run locally; going
  // through the server keeps one implementation authoritative while we settle it.
  useEffect(() => {
    if (graph.nodes.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .compile(graph)
        .then((r) => {
          if (cancelled) return;
          setDiagnostics(r.diagnostics);
          setCanRun(r.plan !== null);
        })
        .catch((e) => {
          if (cancelled) return;
          setDiagnostics([
            {
              severity: "error",
              message: t("common:app.compileFailed", { error: String(e) }),
            },
          ]);
          setCanRun(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The original effect deliberately omits `t`: a language switch must not
    // re-trigger a compile round-trip.
  }, [graph]);

  // 4B.4: collect form-connector fields from every source node, if any.
  const collectFormFields = useCallback((): FormField[] => {
    const out: FormField[] = [];
    for (const n of graph.nodes) {
      if (n.kind === "source" && n.source?.connector?.type === "form") {
        out.push(...(n.source.connector.form?.fields ?? []));
      }
    }
    return out;
  }, [graph]);

  const startRunWith = useCallback(
    async (connectorValues?: Record<string, string>) => {
      try {
        /* toast cleared by the producer */ reset();
        // Go through the serialized store save (not a raw api.saveGraph) so the
        // server version is tracked and can't drift: an unconditional save here
        // would bump the version without recording it, and a later conditional
        // save (switch-graph flush) would 409 on the stale If-Match.
        await flushSave();
        const { runId: id } = await api.startRun(
          graph.id,
          budget,
          rawMaterial.trim() || undefined,
          connectorValues,
        );
        connect(id);
      } catch (e) {
        // A structured subscription 402 opens the upgrade modal instead of a
        // raw error toast; every other failure keeps the normal toast path.
        const block = parseQuotaError(e);
        if (block) useUpgradeGate.getState().open(block);
        else showError(String(e));
      }
    },
    [graph, budget, rawMaterial, connect, reset, flushSave],
  );

  const onRun = useCallback(() => {
    const fields = collectFormFields();
    if (fields.length) {
      setFormFields(fields);
      return;
    }
    void startRunWith();
  }, [collectFormFields, startRunWith]);

  const onFormSubmit = useCallback(
    (values: Record<string, string>) => {
      setFormFields(null);
      void startRunWith(values);
    },
    [startRunWith],
  );

  const onCancel = useCallback(async () => {
    if (runId) await api.cancelRun(runId).catch(() => undefined);
  }, [runId]);

  return {
    mode,
    setMode,
    budget,
    setBudget,
    rawMaterial,
    setRawMaterial,
    diagnostics,
    canRun,
    formFields,
    setFormFields,
    onRun,
    onFormSubmit,
    onCancel,
  };
}
