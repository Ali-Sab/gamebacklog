import { tagColor } from "../../themes";

const MODES: Record<string, string> = {
  atmospheric: "#7dd3fc", narrative: "#f9a8d4", detective: "#86efac",
  tactical: "#c4b5fd", immersive: "#a78bfa", action: "#f87171",
  strategy: "#93c5fd", puzzle: "#fde68a", rpg: "#f0abfc",
};
const MODES_LIGHT: Record<string, string> = {
  atmospheric: "#1565a8", narrative: "#a0237a", detective: "#1a6b40",
  tactical: "#5032b0", immersive: "#5c38a8", action: "#b02020",
  strategy: "#2a509c", puzzle: "#7a5800", rpg: "#8a1a90",
};
const RISK_COLORS: Record<string, string> = { low: "#86efac", medium: "#fbbf24", high: "#f87171" };
const RISK_COLORS_LIGHT: Record<string, string> = { low: "#1a6b40", medium: "#7a5800", high: "#b02020" };

interface Props {
  cat: string;
  modeFilter: string | null;
  riskFilter: string | null;
  sortBy: string;
  theme: string;
  onModeToggle: (m: string) => void;
  onRiskToggle: (r: string) => void;
  onSortChange: (s: string) => void;
}

export function GameFilters({ cat, modeFilter, riskFilter, sortBy, theme, onModeToggle, onRiskToggle, onSortChange }: Props) {
  const showMode = cat !== "played";
  const showRisk = cat === "caveats";

  return (
    <div className="filters">
      {showMode && (
        <>
          <label>Mode:</label>
          {Object.keys(MODES).map((k) => {
            const c = tagColor(MODES, MODES_LIGHT, k, theme);
            const active = modeFilter === k;
            return (
              <button
                key={k}
                className={`filter-btn${active ? " active" : ""}`}
                style={active ? { background: c, borderColor: c, color: theme === "light" ? "#fff" : "#0d0d14" } : {}}
                onClick={() => onModeToggle(k)}
              >
                {k}
              </button>
            );
          })}
        </>
      )}
      {showRisk && (
        <>
          <label>Risk:</label>
          {["low", "medium", "high"].map((r) => {
            const c = tagColor(RISK_COLORS, RISK_COLORS_LIGHT, r, theme);
            const active = riskFilter === r;
            return (
              <button
                key={r}
                className={`filter-btn${active ? " active" : ""}`}
                style={active ? { background: c, borderColor: c, color: theme === "light" ? "#fff" : "#0d0d14" } : {}}
                onClick={() => onRiskToggle(r)}
              >
                {r}
              </button>
            );
          })}
        </>
      )}
      <select className="sort-select" value={sortBy} onChange={(e) => onSortChange(e.target.value)}>
        <option value="rank">Sort: Rank</option>
        <option value="hours">Sort: Hours</option>
        <option value="title">Sort: Title</option>
        {cat === "played" && <option value="playedDate">Sort: Date Played</option>}
      </select>
    </div>
  );
}
