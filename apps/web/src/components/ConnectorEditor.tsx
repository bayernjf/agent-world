import { useEffect, useState } from "react";
import type {
  ConnectorConfig,
  ConnectorType,
  FileConnector,
  FormConnector,
  HttpConnector,
} from "@agent-world/core";
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
  none: "无（用下方「创作简报 / 原始物料」）",
  manual: "手动（同「无」）",
  file: "文件（本地文件 / 目录 / glob）",
  http: "HTTP（拉取 JSON / 文本）",
  form: "表单（运行前填写）",
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
  return (
    <>
      <label className="field">
        <span>路径 / glob</span>
        <input
          className="text-input"
          value={value.path}
          placeholder="/abs/path/data.txt 或 ./dir/**/*.txt"
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
        <span>作为图片（不读文本，把路径作为附图喂下游）</span>
      </label>
      <p className="hint">
        支持 <code>*</code> / <code>?</code> / <code>**</code>
        ；目录会递归收集全部文件。
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
          <span>方法</span>
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
          <span>鉴权</span>
          <select
            className="select"
            value={authType}
            onChange={(e) => {
              const t = e.target.value;
              if (t === "none") patch({ auth: undefined });
              else
                patch({ auth: { type: t as "bearer" | "basic", token: "" } });
            }}
          >
            <option value="none">无</option>
            <option value="bearer">Bearer</option>
            <option value="basic">Basic</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>URL</span>
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
            {authType === "bearer" ? "Token / API Key" : "user:pass 或 token"}
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
        <span>提取字段（逗号分隔的 dot-path，可空）</span>
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
        <span>请求头（JSON 对象，可空）</span>
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
          <span>请求体（JSON 或文本，可空）</span>
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
      <p className="hint">
        运行产线前会弹出此表单，收集的值将作为 source
        文本注入。字段名需全局唯一。
      </p>
      {fields.map((f, i) => (
        <div className="form-field-row" key={f.name || i}>
          <input
            className="text-input"
            placeholder="字段名(name)"
            value={f.name}
            onFocus={begin}
            onBlur={commit}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <input
            className="text-input"
            placeholder="显示(label)"
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
            <span>必填</span>
          </label>
          <Tooltip content="删除字段">
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
        + 添加字段
      </button>
    </>
  );
}

export default function ConnectorEditor({
  connector,
  onChange,
  onBeginEdit,
  onCommitEdit,
}: Props) {
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
      <div className="label">数据源接入（Connector）</div>
      <label className="field field--inline">
        <span>接入方式</span>
        <select
          className="select"
          value={current}
          onChange={(e) => setType(e.target.value as SelectType)}
        >
          {(["none", "file", "http", "form"] as const).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
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
      {connector && connector.type !== "manual" && (
        <div className="connector-test">
          <button
            className="btn btn--ghost"
            onClick={runTest}
            disabled={testState === "loading"}
          >
            {testState === "loading" ? "测试中…" : "测试连接"}
          </button>
          {testState === "ok" && testResult && (
            <div className="connector-test__result">
              <div className="connector-test__meta">
                成功 · 文本 {testResult.fullLength} 字符
                {testResult.images.length > 0 &&
                  ` · 图片 ${testResult.images.length} 张`}
              </div>
              <pre className="connector-test__preview">
                {testResult.text || "(空)"}
              </pre>
            </div>
          )}
          {testState === "error" && (
            <div className="connector-test__error">失败：{testError}</div>
          )}
        </div>
      )}
    </div>
  );
}
