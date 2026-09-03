import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type BrandAsset } from "../lib/api";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
}

const ASSET_TYPES = ["logo", "image", "font", "snippet", "guideline"] as const;

/** F4: reusable brand material library — list, add and delete. */
export default function BrandAssets({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [assets, setAssets] = useState<BrandAsset[]>([]);
  const [type, setType] = useState<string>("image");
  const [label, setLabel] = useState("");
  const [uri, setUri] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAssets(await api.listBrandAssets());
    } catch {
      /* ignore transient failures */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, load]);

  if (!open) return null;

  const add = async () => {
    setError(null);
    if (!label.trim()) return;
    try {
      await api.addBrandAsset({
        type,
        label: label.trim(),
        uri: uri.trim(),
        tags: tags
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setLabel("");
      setUri("");
      setTags("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("modals:brandAssets.addFailed"));
    }
  };

  const remove = async (id: string) => {
    await api.deleteBrandAsset(id);
    await load();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:brandAssets.title")}</h2>
          <Tooltip content={t("common.close")}>
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <p className="muted">{t("modals:brandAssets.hint")}</p>

          <div className="product-add">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {ASSET_TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`modals:brandAssets.types.${k}`)}
                </option>
              ))}
            </select>
            <input
              placeholder={t("modals:brandAssets.labelPh")}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <input
              placeholder={t("modals:brandAssets.uriPh")}
              value={uri}
              onChange={(e) => setUri(e.target.value)}
            />
            <input
              placeholder={t("modals:brandAssets.tagsPh")}
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <button
              className="btn btn--primary btn--sm"
              onClick={() => void add()}
              disabled={!label.trim()}
            >
              {t("modals:brandAssets.add")}
            </button>
          </div>

          <ul className="brand-list">
            {assets.length === 0 && <li className="muted">{t("modals:brandAssets.empty")}</li>}
            {assets.map((a) => (
              <li key={a.id}>
                <div>
                  <span className="asset-type">{t(`modals:brandAssets.types.${a.type}`)}</span>
                  <span className="brand-term">{a.label}</span>
                  {a.uri && <span className="muted"> — {a.uri}</span>}
                  {a.tags.length > 0 && <span className="muted"> [{a.tags.join(", ")}]</span>}
                </div>
                <button className="ghost-btn" onClick={() => void remove(a.id)}>
                  {t("modals:brandAssets.delete")}
                </button>
              </li>
            ))}
          </ul>

          {error && <div className="error-text">{error}</div>}
        </div>
      </div>
    </div>
  );
}
