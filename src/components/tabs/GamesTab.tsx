import { useState, useRef, useEffect, useCallback } from "react";
import { useApp, type Game, type Games } from "../../context/AppContext";
import { GameTable } from "../games/GameTable";
import { GameFilters } from "../games/GameFilters";
import { GameModal } from "../games/GameModal";
import { CAT_LABELS } from "../games/GameRow";
import { useToast } from "../shared/Toast";
import { api } from "../../api";
import { tagColor, tagStyle } from "../../themes";

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

const CAT_COLORS: Record<string, string> = {
  inbox: "#c4b5fd", queue: "#7eb8d4", caveats: "#e8c547",
  decompression: "#b8d47e", yourCall: "#e8a87c", played: "#a8a8a8",
};
const ALL_CATS = ["inbox", "queue", "caveats", "decompression", "yourCall", "played"];

function parseHours(h?: string): number | null {
  const n = parseFloat((h || "").replace(/[~+∞]/g, "").split(/[–-]/)[0]);
  return isNaN(n) ? null : n;
}

function sortGames(list: Game[], mode: string): Game[] {
  const arr = [...list];
  if (mode === "hours") arr.sort((a, b) => (parseHours(a.hours) ?? Infinity) - (parseHours(b.hours) ?? Infinity));
  else if (mode === "title") arr.sort((a, b) => a.title.localeCompare(b.title));
  else if (mode === "playedDate") arr.sort((a, b) => {
    const da = a.playedDate ? new Date(a.playedDate).getTime() : 0;
    const db = b.playedDate ? new Date(b.playedDate).getTime() : 0;
    return db - da;
  });
  else arr.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  return arr;
}

interface Props {
  theme: string;
}

export function GamesTab({ theme }: Props) {
  const { state, setActiveCat, setModeFilter, setRiskFilter, setSortBy, setGlobalSearch, loadApp } = useApp();
  const { showToast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const { games, activeCat, modeFilter, riskFilter, sortBy, globalSearch } = state;
  const tabsRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", updateScrollState); ro.disconnect(); };
  }, [updateScrollState]);

  function queueHours() {
    return (games.queue || []).reduce((a, g) => {
      const n = parseFloat((g.hours || "").replace(/[~+∞]/g, "").split("–")[0]);
      return a + (isNaN(n) ? 0 : n);
    }, 0);
  }

  const sorted = sortGames(games[activeCat] || [], sortBy);
  const filtered = sorted.filter((g) => {
    if (modeFilter && g.mode !== modeFilter) return false;
    if (riskFilter && g.risk !== riskFilter) return false;
    return true;
  });

  // Global search results
  const searchResults: (Game & { _cat: string })[] = [];
  if (globalSearch) {
    const q = globalSearch.toLowerCase();
    Object.entries(games).forEach(([cat, list]) => {
      (list || []).forEach((g) => {
        if (g.title.toLowerCase().includes(q) || (g.note || "").toLowerCase().includes(q)) {
          searchResults.push({ ...g, _cat: cat });
        }
      });
    });
  }

  const isInbox = activeCat === "inbox";
  const inboxCount = (games.inbox || []).length;

  return (
    <div data-testid="tab-games">
      {/* Global search */}
      <div className="global-search-wrap">
        <input
          id="global-search"
          className="global-search-input"
          placeholder="Search all games…"
          value={globalSearch}
          onChange={(e) => setGlobalSearch(e.target.value)}
        />
        {globalSearch && (
          <button
            id="global-clear-btn"
            className="btn btn-ghost btn-sm"
            onClick={() => setGlobalSearch("")}
          >
            Clear
          </button>
        )}
        <button className="btn btn-gold btn-sm btn-add-game" onClick={() => setAddOpen(true)} data-testid="add-game-btn">
          <span className="btn-label">+ Add Game</span>
        </button>
      </div>

      {/* Global search results */}
      {globalSearch ? (
        <>
          <div className="global-results-header" id="global-results-header">
            <span id="global-results-label">{searchResults.length} result{searchResults.length === 1 ? "" : "s"} across all categories</span>
          </div>
          <div className="game-table">
            {searchResults.length === 0 ? (
              <div className="empty-state">No games found for "{globalSearch}"</div>
            ) : (
              <>
                <div className="table-header" style={{ gridTemplateColumns: "1fr 54px 120px 1.6fr" }}>
                  {["Game", "Hours", "Category", "Notes"].map((h) => <span key={h}>{h}</span>)}
                </div>
                {searchResults.map((g) => {
                  const cc = CAT_COLORS[g._cat] || "#888";
                  const catLabel = CAT_LABELS[g._cat] || g._cat;
                  const mc = MODES[g.mode || ""] || "#888";
                  return (
                    <div
                      key={g.id}
                      className="game-row"
                      style={{ gridTemplateColumns: "1fr 54px 120px 1.6fr", cursor: "pointer" }}
                      onClick={() => { setGlobalSearch(""); setActiveCat(g._cat); }}
                    >
                      <div>
                        <div className="game-title">{g.title}</div>
                        {g.mode && (
                          <span className="tag" style={tagStyle(mc, theme)} >{g.mode}</span>
                        )}
                      </div>
                      <div className="game-hours">{g.hours || "?"}h</div>
                      <div>
                        <span className="cat-badge" style={{ background: `${cc}18`, color: cc, border: `1px solid ${cc}28` }}>
                          {catLabel}
                        </span>
                      </div>
                      <div className="game-note">{g.note || ""}</div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Category tabs */}
          <div className="cat-tabs-outer">
            {canScrollLeft && (
              <button className="cat-tabs-arrow cat-tabs-arrow-left" onClick={() => { tabsRef.current?.scrollBy({ left: -120, behavior: "smooth" }); }} aria-label="Scroll left">‹</button>
            )}
            {canScrollRight && (
              <button className="cat-tabs-arrow cat-tabs-arrow-right" onClick={() => { tabsRef.current?.scrollBy({ left: 120, behavior: "smooth" }); }} aria-label="Scroll right">›</button>
            )}
            <div className="cat-tabs" id="normal-games-view" ref={tabsRef}>
            {ALL_CATS.map((c) => (
              <button
                key={c}
                className={`cat-btn${activeCat === c ? " active" : ""}`}
                data-cat={c}
                onClick={() => setActiveCat(c)}
              >
                {CAT_LABELS[c]}{" "}
                <span id={`cnt-${c}`}>({(games[c] || []).length})</span>
              </button>
            ))}
            <span className="cat-meta" id="queue-hours-meta">~{Math.round(queueHours())}h in queue</span>
          </div></div>

          {/* Inbox banner */}
          {isInbox && (
            <div className="inbox-hint">
              {inboxCount === 0 ? (
                <><strong>Inbox</strong> — a holding pen for games you've added but haven't triaged yet. Use <strong>+ Add Game</strong> to drop one here, then ask Claude (Settings → Connect Claude) to sort them into the right category on your next conversation.</>
              ) : (
                <><strong>{inboxCount} game{inboxCount === 1 ? "" : "s"} waiting for triage.</strong> Open Claude (Settings → Connect Claude) and ask it to sort your inbox — it will read these games and queue moves for you to approve in the Pending tab.</>
              )}
            </div>
          )}

          {/* Filters */}
          <GameFilters
            cat={activeCat}
            modeFilter={modeFilter}
            riskFilter={riskFilter}
            sortBy={sortBy}
            theme={theme}
            onModeToggle={(m) => setModeFilter(modeFilter === m ? null : m)}
            onRiskToggle={(r) => setRiskFilter(riskFilter === r ? null : r)}
            onSortChange={setSortBy}
          />

          {/* Game table */}
          <GameTable
            games={filtered}
            cat={activeCat}
            allGames={games}
            sortBy={sortBy}
            theme={theme}
          />

          {/* Legend */}
          <div className="legend" id="game-legend">
            {Object.entries(MODES).map(([k]) => {
              const c = tagColor(MODES, MODES_LIGHT, k, theme);
              return (
                <div key={k} className="legend-item">
                  <div className="legend-dot" style={{ background: c }} />
                  <span className="legend-label">{k}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Add Game modal */}
      {addOpen && (
        <GameModal
          title="Add Game"
          sub="New games go to Inbox. Claude will sort them on your next conversation."
          initial={{}}
          onClose={() => setAddOpen(false)}
          onSubmit={async (fields) => {
            if (!fields.title?.trim()) return false;
            const data = await api("POST", "/api/games", fields);
            if (data.error) { showToast(`Error: ${data.error as string}`); return false; }
            showToast(`Added "${(data.game as Game).title}" to Inbox`);
            await loadApp();
            return true;
          }}
        />
      )}
    </div>
  );
}
