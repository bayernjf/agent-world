import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { McpServerStatus, UserMcpServer } from "../lib/api";

/**
 * Settings → MCP 服务: the user's own remote MCP servers.
 *
 * Only http and sse appear here. stdio is missing on purpose — it spawns a
 * process from a command line, so offering it in a form would be an arbitrary
 * code execution box; it stays operator-only through the MCP_SERVERS env var.
 *
 * Saving runs the handshake immediately and reports what came back, because a
 * silently-saved-but-unreachable server is the failure mode this panel exists
 * to prevent. Reconnect is manual: nothing retries in the background.
 */

interface Props {
  servers: UserMcpServer[];
  onChange: (servers: UserMcpServer[]) => void;
  /** Persist the whole settings form, then handshake this server. */
  onSaveAndConnect: (id: string) => Promise<McpServerStatus>;
  statuses: Record<string, McpServerStatus>;
}

function slug(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "-");
}

export function McpSettings({ servers, onChange, onSaveAndConnect, statuses }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const update = (id: string, patch: Partial<UserMcpServer>) =>
    onChange(servers.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const add = () => {
    // Non-latin names slugify to dashes; fall back to a sequential id.
    const slugged = slug(draftName);
    const id = /[a-z0-9]/.test(slugged) ? slugged.replace(/^-+|-+$/g, "") : `mcp-${servers.length + 1}`;
    if (servers.some((s) => s.id === id)) return;
    onChange([...servers, { id, name: draftName.trim() || id, transport: "http", url: "", enabled: true }]);
    setDraftName("");
  };

  const connect = async (id: string) => {
    setBusy(id);
    try {
      await onSaveAndConnect(id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="settings-section-head">
        <h3 className="label">{t("settings:mcp.title")}</h3>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("settings:mcp.description")}
      </p>

      {servers.length === 0 && <small className="muted">{t("settings:mcp.empty")}</small>}

      {servers.map((server) => {
        const status = statuses[server.id];
        return (
          <div key={server.id} className="model-form" data-testid={`mcp-server-${server.id}`}>
            <label className="field">
              <span>{t("settings:mcp.name")}</span>
              <input
                value={server.name ?? ""}
                onChange={(e) => update(server.id, { name: e.target.value })}
                placeholder={server.id}
              />
            </label>
            <label className="field">
              <span>{t("settings:mcp.transport")}</span>
              <select
                value={server.transport}
                onChange={(e) => update(server.id, { transport: e.target.value as "http" | "sse" })}
              >
                <option value="http">{t("settings:mcp.transportHttp")}</option>
                <option value="sse">{t("settings:mcp.transportSse")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("settings:mcp.url")}</span>
              <input
                value={server.url}
                onChange={(e) => update(server.id, { url: e.target.value })}
                placeholder="https://example.com/mcp"
              />
            </label>
            <label className="field">
              <span>{t("settings:mcp.authHeader")}</span>
              <input
                type="password"
                value={server.headers?.Authorization ?? ""}
                onChange={(e) =>
                  update(server.id, {
                    headers: e.target.value ? { ...server.headers, Authorization: e.target.value } : undefined,
                  })
                }
                placeholder="Bearer ..."
              />
            </label>
            <small className="muted">{t("settings:mcp.authHeaderHint")}</small>
            <label className="toggle mcp-toggle">
              <input
                type="checkbox"
                checked={server.enabled !== false}
                onChange={(e) => update(server.id, { enabled: e.target.checked })}
              />
              <span>{t("settings:mcp.enabled")}</span>
            </label>

            <div className="mcp-actions">
              <button className="btn" disabled={busy === server.id || !server.url} onClick={() => void connect(server.id)}>
                {busy === server.id ? t("settings:mcp.connecting") : t("settings:mcp.saveAndConnect")}
              </button>
              <button className="link mcp-bad" onClick={() => onChange(servers.filter((s) => s.id !== server.id))}>
                {t("settings:mcp.remove")}
              </button>
            </div>

            {status && (
              <small className={status.connected ? "mcp-ok" : "mcp-bad"} data-testid={`mcp-status-${server.id}`}>
                {status.connected
                  ? t("settings:mcp.connected", { count: status.toolCount, tools: status.toolNames.join(", ") })
                  : t("settings:mcp.failed", { error: status.error ?? "" })}
              </small>
            )}
          </div>
        );
      })}

      <div className="mcp-actions">
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder={t("settings:mcp.newPlaceholder")}
          aria-label={t("settings:mcp.add")}
        />
        <button className="btn" onClick={add}>
          {t("settings:mcp.add")}
        </button>
      </div>
      <small className="muted">{t("settings:mcp.note")}</small>
    </>
  );
}
