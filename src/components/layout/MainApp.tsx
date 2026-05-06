import { useState, useEffect } from "react";
import { TopBar } from "./TopBar";
import { GamesTab } from "../tabs/GamesTab";
import { ProfileTab } from "../tabs/ProfileTab";
import { PendingTab } from "../tabs/PendingTab";
import { SettingsTab } from "../tabs/SettingsTab";
import { useApp } from "../../context/AppContext";

type Tab = "games" | "profile" | "pending" | "settings";

const TAB_ICONS: Record<Tab, string> = {
  games: "◉",
  profile: "◎",
  pending: "◈",
  settings: "⚙",
};

interface Props {
  theme: string;
  onThemeChange: (t: string) => void;
}

export function MainApp({ theme, onThemeChange }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("games");
  const { state, loadPending } = useApp();
  const pendingCount = state.pendingItems.length;

  // Poll pending every 30s while logged in
  useEffect(() => {
    const timer = setInterval(loadPending, 30000);
    return () => clearInterval(timer);
  }, [loadPending]);

  return (
    <div id="main-app" data-testid="screen-main">
      <TopBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="content">
        {activeTab === "games" && <GamesTab theme={theme} />}
        {activeTab === "profile" && <ProfileTab />}
        {activeTab === "pending" && <PendingTab theme={theme} />}
        {activeTab === "settings" && <SettingsTab theme={theme} onThemeChange={onThemeChange} />}
      </div>
      <nav className="bottom-nav">
        {(["games", "profile", "pending", "settings"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`bottom-nav-btn${activeTab === t ? " active" : ""}`}
            onClick={() => setActiveTab(t)}
          >
            <span className="bottom-nav-icon">{TAB_ICONS[t]}</span>
            <span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
            {t === "pending" && pendingCount > 0 && (
              <span className="pending-badge" style={{ position: "absolute", top: 6, right: "calc(50% - 18px)" }}>{pendingCount}</span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
