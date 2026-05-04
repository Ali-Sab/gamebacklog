import { useState } from "react";
import { useApp, type PendingItem } from "../../context/AppContext";
import { api } from "../../api";
import { tagColor, tagStyle } from "../../themes";

const TYPE_COLORS: Record<string, string> = { game_move: "#7dd3fc", profile_update: "#f9a8d4", new_game: "#86efac", reorder: "#c4b5fd", game_edit: "#fde68a" };
const TYPE_COLORS_LIGHT: Record<string, string> = { game_move: "#1565a8", profile_update: "#a0237a", new_game: "#1a6b40", reorder: "#5032b0", game_edit: "#7a5800" };
const TYPE_LABELS: Record<string, string> = { game_move: "Game Move", profile_update: "Profile Update", new_game: "New Game", reorder: "Reorder", game_edit: "Game Edit" };
const CAT_LABELS: Record<string, string> = { inbox: "Inbox", queue: "Play Queue", caveats: "With Caveats", decompression: "Decompression", yourCall: "Your Call", played: "Played" };

function pendingDesc(item: PendingItem): { __html: string } {
  const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const d = item.data;
  if (item.type === "game_move") {
    const { title, fromCategory, toCategory } = d as { title: string; fromCategory: string; toCategory: string };
    return { __html: `Move <strong>${esc(title)}</strong> from <em>${CAT_LABELS[fromCategory] || fromCategory}</em> to <em>${CAT_LABELS[toCategory] || toCategory}</em>` };
  }
  if (item.type === "profile_update") return { __html: `Update profile section: <strong>${esc((d as { section: string }).section)}</strong>` };
  if (item.type === "new_game") return { __html: `Add <strong>${esc((d as { title: string }).title)}</strong> to <em>${CAT_LABELS[(d as { category: string }).category] || (d as { category: string }).category}</em>` };
  if (item.type === "game_edit") {
    const { title, changes } = d as { title: string; changes: Record<string, unknown> };
    const parts = Object.entries(changes).map(([k, v]) => `${k}: <em>${esc(String(v))}</em>`);
    return { __html: `Edit <strong>${esc(title)}</strong> — ${parts.join(", ")}` };
  }
  if (item.type === "reorder") {
    const { category, rankedTitles } = d as { category: string; rankedTitles: string[] };
    return { __html: `Reorder <em>${CAT_LABELS[category] || category}</em> (${rankedTitles?.length ?? 0} games)` };
  }
  return { __html: esc(item.type) };
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

interface Props {
  theme: string;
}

export function PendingTab({ theme }: Props) {
  const { state, approvePending, rejectPending, approveAll, loadPending } = useApp();
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyItems, setHistoryItems] = useState<PendingItem[]>([]);
  const [approveAllLoading, setApproveAllLoading] = useState(false);

  const pendingItems = state.pendingItems;

  async function handleApproveAll() {
    setApproveAllLoading(true);
    await approveAll();
    setApproveAllLoading(false);
  }

  async function toggleHistory() {
    if (historyVisible) { setHistoryVisible(false); return; }
    setHistoryVisible(true);
    const all = await api("GET", "/api/pending/history");
    if (Array.isArray(all)) {
      setHistoryItems((all as PendingItem[]).filter((p) => p.status !== "pending"));
    }
  }

  return (
    <div data-testid="tab-pending">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--gold)" }}>
          Pending Suggestions
          {pendingItems.length > 0 && (
            <span className="pending-badge">{pendingItems.length}</span>
          )}
        </div>
        {pendingItems.length >= 1 && (
          <button
            id="approve-all-btn"
            className="btn btn-gold btn-sm"
            onClick={handleApproveAll}
            disabled={approveAllLoading}
            data-testid="approve-all-btn"
          >
            {approveAllLoading ? "Approving…" : "Approve All"}
          </button>
        )}
        <button id="refresh-pending-btn" className="btn btn-ghost btn-sm" onClick={loadPending}>Refresh</button>
        <button className="btn btn-ghost btn-sm" onClick={toggleHistory} style={{ marginLeft: "auto" }}>
          {historyVisible ? "Hide History" : "Show History"}
        </button>
      </div>

      <div id="pending-list">
        {pendingItems.length === 0 ? (
          <div className="empty-pending">No pending suggestions. Connect Claude via Settings and ask it to evaluate your library.</div>
        ) : (
          pendingItems.map((item) => {
            const color = tagColor(TYPE_COLORS, TYPE_COLORS_LIGHT, item.type, theme);
            const detail =
              item.type === "new_game" && (item.data as { note?: string }).note
                ? <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8, lineHeight: 1.65 }}>{(item.data as { note: string }).note}</div>
                : item.type === "profile_update" && (item.data as { change?: string }).change
                ? <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8, lineHeight: 1.65 }}>{(item.data as { change: string }).change}</div>
                : null;

            return (
              <div key={item.id} className="pending-card">
                <div>
                  <span className="pending-type-badge" style={tagStyle(color, theme)}>
                    {TYPE_LABELS[item.type] || item.type}
                  </span>
                </div>
                <div className="pending-desc" dangerouslySetInnerHTML={pendingDesc(item)} />
                {detail}
                <div className="pending-reason">"{item.reason}"</div>
                <div className="pending-meta">Suggested {fmtDate(item.createdAt)}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-gold btn-sm" onClick={() => approvePending(item.id)} data-testid={`approve-${item.id}`}>Approve</button>
                  <button className="btn btn-danger btn-sm" onClick={() => rejectPending(item.id)} data-testid={`reject-${item.id}`}>Reject</button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {historyVisible && (
        <div id="pending-history" style={{ marginTop: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--gold)", marginBottom: 12 }}>History</div>
          {historyItems.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)", fontStyle: "italic" }}>No history yet.</div>
          ) : (
            historyItems.map((item) => (
              <div key={item.id} className="history-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: "var(--sub)" }} dangerouslySetInnerHTML={pendingDesc(item)} />
                  <span style={{ color: item.status === "approved" ? "var(--green)" : "var(--red)", fontSize: 12 }}>{item.status}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{fmtDate(item.createdAt)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
