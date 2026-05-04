import { useState, useEffect } from "react";
import { TopBar } from "./TopBar";
import { GamesTab } from "../tabs/GamesTab";
import { ProfileTab } from "../tabs/ProfileTab";
import { PendingTab } from "../tabs/PendingTab";
import { SettingsTab } from "../tabs/SettingsTab";
import { useApp } from "../../context/AppContext";

type Tab = "games" | "profile" | "pending" | "settings";

interface Props {
  theme: string;
  onThemeChange: (t: string) => void;
}

export function MainApp({ theme, onThemeChange }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("games");
  const { loadPending } = useApp();

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
    </div>
  );
}
