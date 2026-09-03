import { useEffect, useState } from "react";
import type {
  ConnectorConfig,
  ConnectorType,
  DatabaseConnector,
  FileConnector,
  FormConnector,
  HttpConnector,
  ProductConnector,
} from "@agent-world/core";
import { Trans, useTranslation } from "react-i18next";
import Tooltip from "./Tooltip";

async function testConnector(
  connector: ConnectorConfig,
  formValues?: Record<string, string>,
): Promise<{ text: string; images: string[]; fullLength: number }> {
  const res = await fetch("/api/connectors/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connector, formValues }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

type FormField = FormConnector["fields"][number];

interface Props {
  connector?: ConnectorConfig;
  onChange: (c: ConnectorConfig | undefined) => void;
  onBeginEdit: () => void;
  onCommitEdit: () => void;
}

type SelectType = "none" | ConnectorType;
const TYPE_LABELS: Record<SelectType, string> = {
  none: "modals:connector.typesFull.none",
  manual: "modals:connector.typesFull.manual",
  file: "modals:connector.typesFull.file",
  http: "modals:connector.typesFull.http",
  form: "modals:connector.typesFull.form",
  database: "modals:connector.typesFull.database",
  product: "modals:connector.typesFull.product",
};

function defaultsFor(type: ConnectorType): ConnectorConfig {
  switch (type) {
    case "file":
      return {
        type: "file",
        file: { path: "", encoding: "utf8", asImages: false },
      };
    case "http":
      return { type: "http", http: { url: "", method: "GET" } };
    case "form":
      return { type: "form", form: { fields: [] } };
    case "database":
      return {
        type: "database",
        database: { driver: "sqlite", path: "", query: "SELECT * FROM ", format: "json" },
      };
    case "product":
      return { type: "product", product: { selection: "all" } };
    case "manual":
      return { type: "manual" };
  }
}

function FileForm({
  value,
  patch,
  begin,
  commit,
}: {
  value: FileConnector;
  patch: (p: Partial<FileConnector>) => void;
  begin: () => void;
  commit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <label className="field">
        <span>{t("modals:connector.file.pathLabel")}</span>
        <input
          className="text-input"
          value={value.path}
          placeholder={t("modals:connector.file.pathPlaceholder")}
          onFocus={begin}
          onBlur={commit}
          onChange={(e) => patch({ path: e.target.value })}
        />
      </label>
      <label className="field field--inline">
        <input
          type="checkbox"
          checked={value.asImages ?? false}
          onChange={(e) => patch({ asImages: e.target.checked })}
        />
        <span>{t("modals:connector.file.asImages")}</span>
      </label>
      <p className="hint">
        <Trans
          i18nKey="modals:connector.file.hint"
          components={{ code: <code /> }}
        />
      </p>
    </>
  );
}

function HttpForm({
  value,
  patch,
  begin,
  commit,
}: {
  value: HttpConnector;
  patch: (p: Partial<HttpConnector>) => void;
  begin: () => void;
  commit: () => void;
}) {
  const { t } = useTranslation();
  const authType = value.auth?.type ?? "none";
  const [headersText, setHeadersText] = useState("");
  const [bodyText, setBodyText] = useState("");
  useEffect(() => {
    setHeadersText(value.headers ? JSON.stringify(value.headers, null, 2) : "");
  }, [value.headers]);
  useEffect(() => {
    setBodyText(
      typeof value.body === "string"
        ? value.body
        : value.body
          ? JSON.stringify(value.body, null, 2)
          : "",
    );
  }, [value.body]);

  return (
    <>
      <div className="field-row">
        <label className="field field--inline">
          <span>{t("modals:connector.http.method")}</span>
          <select
            className="select"
            value={value.method ?? "GET"}
            onChange={(e) =>
              patch({ method: e.target.value as "GET" | "POST" })
            }
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </label>
        <label className="field field--inline">
          <span>{t("modals:connector.http.auth")}</span>
          <select
            className="select"
            value={authType}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "none") patch({ auth: undefined });
              else
                patch({ auth: { type: v as "bearer" | "basic", token: "" } });
            }}
          >
            <option value="none">{t("modals:connector.http.authNone")}</option>
            <option value="bearer">Bearer</option>
            <option value="basic">Basic</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>{t("modals:connector.http.url")}</span>
        <input
          className="text-input"
          value={value.url}
          placeholder="https://api.example.com/data"
          onFocus={begin}
          onBlur={commit}
          onChange={(e) => patch({ url: e.target.value })}
        />
      </label>
      {authType !== "none" && (
        <label className="field">
          <span>
            {authType === "bearer"
              ? t("modals:connector.http.tokenLabel")
              : t("modals:connector.http.tokenLabelBasic")}
          </span>
          <input
            className="text-input"
            type="password"
            value={value.auth?.token ?? ""}
            onFocus={begin}
            onBlur={commit}
            onChange={(e) =>
              patch({
                auth: {
                  type: authType as "bearer" | "basic",
                  token: e.target.value,
                },
              })
            }
          />
        </label>
      )}
      <label className="field">
        <span>{t("modals:connector.http.extract")}</span>
        <input
          className="text-input"
          value={(value.extract ?? []).join(", ")}
          placeholder="items.0.name, note"
          onFocus={begin}
          onBlur={commit}
          onChange={(e) =>
            patch({
              extract: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      <label className="field">
        <span>{t("modals:connector.http.headers")}</span>
        <textarea
          className="textarea"
          rows={3}
          value={headersText}
          onChange={(e) => setHeadersText(e.target.value)}
          onFocus={begin}
          onBlur={() => {
            try {
              patch({ headers: JSON.parse(headersText) });
            } catch {
              /* ignore invalid JSON while typing */
            }
            commit();
          }}
        />
      </label>
      {value.method === "POST" && (
        <label className="field">
          <span>{t("modals:connector.http.body")}</span>
          <textarea
            className="textarea"
            rows={3}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            onFocus={begin}
            onBlur={() => {
              patch({ body: bodyText });
              commit();
            }}
          />
        </label>
      )}
    </>
  );
}

function FormForm({
  value,
  patch,
  begin,
  commit,
}: {
  value: FormConnector;
  patch: (p: Partial<FormConnector>) => void;
  begin: () => void;
  commit: () => void;
}) {
  const { t } = useTranslation();
  const fields = value.fields;
  const update = (i: number, p: Partial<FormField>) => {
    const cur = fields[i];
    if (!cur) return;
    const next = fields.slice();
    next[i] = {
      name: p.name ?? cur.name,
      label: p.label ?? cur.label,
      required: p.required ?? cur.required,
    };
    patch({ fields: next });
  };
  const add = () =>
    patch({ fields: [...fields, { name: "", label: "", required: false }] });
  const remove = (i: number) =>
    patch({ fields: fields.filter((_, j) => j !== i) });

  return (
    <>
      <p className="hint">{t("modals:connector.form.hint")}</p>
      {fields.map((f, i) => (
        <div className="form-field-row" key={f.name || i}>
          <input
            className="text-input"
            placeholder={t("modals:connector.form.namePlaceholder")}
            value={f.name}
            onFocus={begin}
            onBlur={commit}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <input
            className="text-input"
            placeholder={t("modals:connector.form.labelPlaceholder")}
            value={f.label ?? ""}
            onFocus={begin}
            onBlur={commit}
            onChange={(e) => update(i, { label: e.target.value })}
          />
          <label className="field--inline">
            <input
              type="checkbox"
              checked={f.required ?? false}
              onChange={(e) => update(i, { required: e.target.checked })}
            />
            <span>{t("modals:connector.form.required")}</span>
          </label>
          <Tooltip content={t("modals:connector.form.deleteField")}>
            <button
              className="btn btn--ghost btn--icon"
              onClick={() => remove(i)}
            >
              ×
            </button>
          </Tooltip>
        </div>
      ))}
      <button className="btn btn--ghost" onClick={add}>
        {t("modals:connector.form.addField")}
      </button>
    </>
  );
}

function DatabaseForm({
  value,
  patch,
  begin,
  commit,
}: {
  value: DatabaseConnector;
  patch: (p: Partial<DatabaseConnector>) => void;
  begin: () => void;
  commit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <label className="field">
        <span>{t("modals:connector.database.pathLabel")}</span>
        <input
          className="text-input"
          value={value.path}
          placeholder="/abs/path/data.db"
          onFocus={begin}
          onBlur={commit}
          onChange={(e) => patch({ path: e.target.value })}
        />
      </label>
      <label className="field">
        <span>{t("modals:connector.database.queryLabel")}</span>
        <textarea
          className="textarea"
          rows={4}
          value={value.query}
          placeholder="SELECT * FROM products WHERE price > ?"
          onFocus={begin}
          onBlur={commit}
          onChange={(e) => patch({ query: e.target.value })}
        />
      </label>
      <label className="field field--inline">
        <span>{t("modals:connector.database.format")}</span>
        <select
          className="select"
          value={value.format ?? "json"}
          onChange={(e) => patch({ format: e.target.value as "json" | "csv" })}
        >
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
        </select>
      </label>
      <p className="hint">
        <Trans
          i18nKey="modals:connector.database.hint"
          components={{ code: <code /> }}
        />
      </p>
    </>
  );
}

function ProductForm({
  value,
  patch,
  begin,
  commit,
}: {
  value: ProductConnector;
  patch: (p: Partial<ProductConnector>) => void;
  begin: () => void;
  commit: () => void;
}) {
  const { t } = useTranslation();
  const [idsText, setIdsText] = useState((value.productIds ?? []).join(", "));
  const [filterText, setFilterText] = useState(JSON.stringify(value.filter ?? {}, null, 2));
  return (
    <>
      <label className="field field--inline">
        <span>{t("modals:connector.product.selectionLabel")}</span>
        <select
          className="select"
          value={value.selection ?? "manual"}
          onChange={(e) => patch({ selection: e.target.value as "manual" | "filter" | "all" })}
        >
          <option value="manual">{t("modals:connector.product.manual")}</option>
          <option value="all">{t("modals:connector.product.all")}</option>
          <option value="filter">{t("modals:connector.product.filter")}</option>
        </select>
      </label>
      {value.selection === "manual" && (
        <label className="field">
          <span>{t("modals:connector.product.idsLabel")}</span>
          <textarea
            className="textarea"
            rows={2}
            value={idsText}
            placeholder={t("modals:connector.product.idsPh")}
            onFocus={begin}
            onBlur={() => {
              patch({ productIds: idsText.split(/[,，\s]+/).filter(Boolean) });
              commit();
            }}
            onChange={(e) => setIdsText(e.target.value)}
          />
        </label>
      )}
      {value.selection === "filter" && (
        <label className="field">
          <span>{t("modals:connector.product.filterLabel")}</span>
          <textarea
            className="textarea"
            rows={3}
            value={filterText}
            placeholder={t("modals:connector.product.filterPh")}
            onFocus={begin}
            onBlur={() => {
              try {
                patch({ filter: JSON.parse(filterText) });
              } catch {
                /* ignore invalid JSON while typing */
              }
              commit();
            }}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </label>
      )}
      <p className="hint">{t("modals:connector.product.hint")}</p>
    </>
  );
}

export default function ConnectorEditor({
  connector,
  onChange,
  onBeginEdit,
  onCommitEdit,
}: Props) {
  const { t } = useTranslation();
  const current: SelectType = connector?.type ?? "none";
  const [testState, setTestState] = useState<
    "idle" | "loading" | "ok" | "error"
  >("idle");
  const [testResult, setTestResult] = useState<{
    text: string;
    images: string[];
    fullLength: number;
  } | null>(null);
  const [testError, setTestError] = useState<string>("");

  const setType = (v: SelectType) => {
    if (v === "none") onChange(undefined);
    else onChange(defaultsFor(v));
    setTestState("idle");
    setTestResult(null);
  };
  const patchFile = (p: Partial<FileConnector>) =>
    onChange({
      type: "file",
      file: { ...(connector as { file?: FileConnector }).file!, ...p },
    });
  const patchHttp = (p: Partial<HttpConnector>) =>
    onChange({
      type: "http",
      http: { ...(connector as { http?: HttpConnector }).http!, ...p },
    });
  const patchForm = (p: Partial<FormConnector>) =>
    onChange({
      type: "form",
      form: { ...(connector as { form?: FormConnector }).form!, ...p },
    });
  const patchDatabase = (p: Partial<DatabaseConnector>) =>
    onChange({
      type: "database",
      database: { ...(connector as { database?: DatabaseConnector }).database!, ...p },
    });
  const patchProduct = (p: Partial<ProductConnector>) =>
    onChange({
      type: "product",
      product: { ...(connector as { product?: ProductConnector }).product!, ...p },
    });

  const runTest = async () => {
    if (!connector) return;
    setTestState("loading");
    setTestError("");
    setTestResult(null);
    try {
      const result = await testConnector(connector);
      setTestResult(result);
      setTestState("ok");
    } catch (e) {
      setTestError((e as Error).message);
      setTestState("error");
    }
  };

  return (
    <div className="section connector">
      <div className="label">{t("modals:connector.sectionLabel")}</div>
      <label className="field field--inline">
        <span>{t("modals:connector.sourceType")}</span>
        <select
          className="select"
          value={current}
          onChange={(e) => setType(e.target.value as SelectType)}
        >
          {(["none", "file", "http", "form", "database", "product"] as const).map((typ) => (
            <option key={typ} value={typ}>
              {t(TYPE_LABELS[typ])}
            </option>
          ))}
        </select>
      </label>
      {connector?.type === "file" && (
        <FileForm
          value={connector.file!}
          patch={patchFile}
          begin={onBeginEdit}
          commit={onCommitEdit}
        />
      )}
      {connector?.type === "http" && (
        <HttpForm
          value={connector.http!}
          patch={patchHttp}
          begin={onBeginEdit}
          commit={onCommitEdit}
        />
      )}
      {connector?.type === "form" && (
        <FormForm
          value={connector.form!}
          patch={patchForm}
          begin={onBeginEdit}
          commit={onCommitEdit}
        />
      )}
      {connector?.type === "database" && (
        <DatabaseForm
          value={connector.database!}
          patch={patchDatabase}
          begin={onBeginEdit}
          commit={onCommitEdit}
        />
      )}
      {connector?.type === "product" && (
        <ProductForm
          value={connector.product!}
          patch={patchProduct}
          begin={onBeginEdit}
          commit={onCommitEdit}
        />
      )}
      {connector && connector.type !== "manual" && (
        <div className="connector-test">
          <button
            className="btn btn--ghost"
            onClick={runTest}
            disabled={testState === "loading"}
          >
            {testState === "loading"
              ? t("modals:connector.testing")
              : t("modals:connector.test")}
          </button>
          {testState === "ok" && testResult && (
            <div className="connector-test__result">
              <div className="connector-test__meta">
                {t("modals:connector.testResult.chars", {
                  chars: testResult.fullLength,
                })}
                {testResult.images.length > 0 &&
                  t("modals:connector.testResult.images", {
                    n: testResult.images.length,
                  })}
              </div>
              <pre className="connector-test__preview">
                {testResult.text || t("modals:connector.testResult.empty")}
              </pre>
            </div>
          )}
          {testState === "error" && (
            <div className="connector-test__error">
              {t("modals:connector.testResult.failed", { error: testError })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
