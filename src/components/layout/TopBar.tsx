import { useApp } from "../../context/AppContext";
import { usePendingPoll } from "../../hooks/usePendingPoll";

type Tab = "games" | "profile" | "pending" | "settings";

interface Props {
  activeTab: Tab;
  onTabChange: (t: Tab) => void;
}

export function TopBar({ activeTab, onTabChange }: Props) {
  const { state } = useApp();
  const pendingCount = state.pendingItems.length;

  const total = Object.values(state.games).reduce((a, c) => a + (c ? c.length : 0), 0);
  const played = (state.games.played || []).length;

  return (
    <div className="top-bar">
      <div style={{ display: "flex", alignItems: "center" }}>
        <h1>Game Backlog</h1>
        <span className="meta" id="top-meta">{total} games · {played} played</span>
      </div>
      <nav className="nav">
        {(["games", "profile", "pending", "settings"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`nav-btn${activeTab === t ? " active" : ""}`}
            data-tab={t}
            onClick={() => onTabChange(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === "pending" && pendingCount > 0 && (
              <span className="pending-badge" id="pending-badge">{pendingCount}</span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
