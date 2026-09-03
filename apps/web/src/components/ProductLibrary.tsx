import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type Product } from "../lib/api";
import Tooltip from "./Tooltip";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** F4: reusable product library — list, add, archive/restore, delete and CSV import. */
export default function ProductLibrary({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [csv, setCsv] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProducts(await api.listProducts());
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
    if (!name.trim()) return;
    try {
      await api.addProduct({
        name: name.trim(),
        sku: sku.trim(),
        brand: brand.trim(),
        category: category.trim(),
        price: price.trim() === "" ? null : Number(price),
      });
      setName("");
      setSku("");
      setBrand("");
      setCategory("");
      setPrice("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("modals:productLibrary.addFailed"));
    }
  };

  const remove = async (id: string) => {
    await api.deleteProduct(id);
    await load();
  };

  const toggleStatus = async (p: Product) => {
    await api.updateProduct(p.id, { status: p.status === "active" ? "archived" : "active" });
    await load();
  };

  const importCsv = async () => {
    setError(null);
    setImportResult(null);
    if (!csv.trim()) return;
    try {
      const r = await api.importProducts(csv);
      const errors = r.errors.length ? "：" + r.errors.join("；") : "";
      setImportResult(
        t("modals:productLibrary.importResult", {
          imported: r.imported,
          failed: r.failed,
          errors,
        }),
      );
      setCsv("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("modals:productLibrary.importFailed"));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>{t("modals:productLibrary.title")}</h2>
          <Tooltip content={t("common.close")}>
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </Tooltip>
        </div>
        <div className="modal__body">
          <p className="muted">{t("modals:productLibrary.hint")}</p>

          <div className="product-add">
            <input
              placeholder={t("modals:productLibrary.namePh")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              placeholder={t("modals:productLibrary.skuPh")}
              value={sku}
              onChange={(e) => setSku(e.target.value)}
            />
            <input
              placeholder={t("modals:productLibrary.brandPh")}
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            />
            <input
              placeholder={t("modals:productLibrary.categoryPh")}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <input
              placeholder={t("modals:productLibrary.pricePh")}
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <button
              className="btn btn--primary btn--sm"
              onClick={() => void add()}
              disabled={!name.trim()}
            >
              {t("modals:productLibrary.add")}
            </button>
          </div>

          <table className="product-table">
            <thead>
              <tr>
                <th>{t("modals:productLibrary.colName")}</th>
                <th>{t("modals:productLibrary.colBrand")}</th>
                <th>{t("modals:productLibrary.colCategory")}</th>
                <th>{t("modals:productLibrary.colPrice")}</th>
                <th>{t("modals:productLibrary.colStatus")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {t("modals:productLibrary.empty")}
                  </td>
                </tr>
              )}
              {products.map((p) => (
                <tr key={p.id} className={p.status === "archived" ? "is-archived" : ""}>
                  <td>{p.name}</td>
                  <td>{p.brand || "—"}</td>
                  <td>{p.category || "—"}</td>
                  <td>{p.price != null ? `¥${p.price}` : "—"}</td>
                  <td>
                    {p.status === "active"
                      ? t("modals:productLibrary.active")
                      : t("modals:productLibrary.archived")}
                  </td>
                  <td className="row-actions">
                    <button className="ghost-btn" onClick={() => void toggleStatus(p)}>
                      {p.status === "active"
                        ? t("modals:productLibrary.archive")
                        : t("modals:productLibrary.restore")}
                    </button>
                    <button className="ghost-btn" onClick={() => void remove(p.id)}>
                      {t("modals:productLibrary.delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="csv-import">
            <p className="muted">{t("modals:productLibrary.csvHint")}</p>
            <textarea
              rows={4}
              placeholder={t("modals:productLibrary.csvPh")}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
            <button
              className="btn btn--sm"
              onClick={() => void importCsv()}
              disabled={!csv.trim()}
            >
              {t("modals:productLibrary.importCsv")}
            </button>
            {importResult && <p className="muted">{importResult}</p>}
          </div>

          {error && <div className="error-text">{error}</div>}
        </div>
      </div>
    </div>
  );
}
