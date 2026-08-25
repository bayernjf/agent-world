import { useEffect, useState } from "react";
import { api, type AppConfig } from "../lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function Settings({ open, onClose }: Props) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState<string>("");
  const [newKey, setNewKey] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      api.getSettings().then(setConfig).catch((e) => setStatus(`加载失败: ${e}`));
    }
  }, [open]);

  if (!open || !config) return null;

  const updateProvider = (name: string, patch: Partial<AppConfig["providers"][string]>) => {
    setConfig({
      ...config,
      providers: { ...config.providers, [name]: { ...config.providers[name]!, ...patch } },
    });
  };

  const setPrice = (provider: string, model: string, field: "input" | "output", value: string) => {
    const p = config.providers[provider]!;
    const pricing = { ...(p.pricing ?? {}) };
    const current = pricing[model] ?? {};
    const num = value === "" ? undefined : Number(value);
    pricing[model] = { ...current, [field]: num };
    updateProvider(provider, { pricing });
  };

  const save = async () => {
    const toSave: AppConfig = {
      ...config,
      providers: Object.fromEntries(
        Object.entries(config.providers).map(([name, p]) => [
          name,
          newKey[name] ? { ...p, apiKey: newKey[name] } : p,
        ]),
      ),
    };
    try {
      await api.saveSettings(toSave);
      setStatus("已保存");
      setNewKey({});
      setTimeout(onClose, 800);
    } catch (e) {
      setStatus(`保存失败: ${e}`);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>设置 · 模型与密钥</h2>
          <button className="link" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="modal__body">
          <label className="field">
            <span>默认模型</span>
            <input
              value={config.defaultModel}
              onChange={(e) => setConfig({ ...config, defaultModel: e.target.value })}
            />
          </label>

          <h3 className="label">Provider</h3>
          {Object.entries(config.providers).map(([name, p]) => (
            <div key={name} className="provider-card">
              <div className="provider-card__head">
                <strong>{name}</strong>
                <span className="muted">{p.type}</span>
              </div>
              {p.type === "openai-compatible" && (
                <>
                  <label className="field">
                    <span>Base URL</span>
                    <input
                      value={p.baseUrl ?? ""}
                      onChange={(e) => updateProvider(name, { baseUrl: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>API Key</span>
                    <input
                      type="password"
                      placeholder={p.apiKey ? `${p.apiKey}` : "未配置"}
                      value={newKey[name] ?? ""}
                      onChange={(e) => setNewKey({ ...newKey, [name]: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>模型（逗号分隔）</span>
                    <input
                      value={p.models.join(", ")}
                      onChange={(e) =>
                        updateProvider(name, {
                          models: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                        })
                      }
                    />
                  </label>
                  {p.models.length > 0 && (
                    <div className="field">
                      <span>单价（USD / 100万 token，留空不计费）</span>
                      {p.models.map((m) => (
                        <div key={m} className="price-row">
                          <code className="price-name">{m}</code>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="入"
                            value={p.pricing?.[m]?.input ?? ""}
                            onChange={(e) => setPrice(name, m, "input", e.target.value)}
                          />
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="出"
                            value={p.pricing?.[m]?.output ?? ""}
                            onChange={(e) => setPrice(name, m, "output", e.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}

          {status && <p className="diag diag--ok">{status}</p>}
        </div>

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
