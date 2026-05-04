import { useState } from "react";
import type { Game } from "../../context/AppContext";
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
const RISK_COLORS: Record<string, string> = { low: "#86efac", medium: "#fbbf24", high: "#f87171" };
const RISK_COLORS_LIGHT: Record<string, string> = { low: "#1a6b40", medium: "#7a5800", high: "#b02020" };

export const CAT_LABELS: Record<string, string> = {
  inbox: "Inbox", queue: "Play Queue", caveats: "With Caveats",
  decompression: "Decompression", yourCall: "Your Call", played: "Played",
};

interface Props {
  game: Game;
  index: number;
  cat: string;
  cols: string;
  theme: string;
  isInbox: boolean;
  onMove: (id: string, fromCat: string, toCat: string) => void;
  onPlayed: (id: string, fromCat: string) => void;
  onEdit: (game: Game, cat: string) => void;
  onDelete: (game: Game, cat: string) => void;
  onSaveNote: (id: string, cat: string, note: string) => void;
}

const MOVE_CATS = ["queue", "caveats", "decompression", "yourCall"];

export function GameRow({ game, index, cat, cols, theme, isInbox, onMove, onPlayed, onEdit, onDelete, onSaveNote }: Props) {
  const [editingNote, setEditingNote] = useState(false);
  const [noteVal, setNoteVal] = useState(game.note || "");

  function saveNote() {
    onSaveNote(game.id, cat, noteVal);
    setEditingNote(false);
  }

  const modeColor = tagColor(MODES, MODES_LIGHT, game.mode || "", theme);
  const riskColor = game.risk ? tagColor(RISK_COLORS, RISK_COLORS_LIGHT, game.risk, theme) : "";

  return (
    <div className="game-row" style={{ gridTemplateColumns: cols }}>
      {!isInbox && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, paddingTop: 1 }}>
          <div className={`game-rank${index < 5 ? " top" : ""}`}>{String(index + 1).padStart(2, "0")}</div>
        </div>
      )}

      <div>
        <div className="game-title">
          {game.title}
          {game.url && (
            <a className="game-link" href={game.url} target="_blank" rel="noopener noreferrer" title={game.url}>↗</a>
          )}
        </div>
        {game.playedDate && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>Played {game.playedDate}</div>
        )}
      </div>

      <div className="game-hours">{game.hours || "?"}h</div>

      <div>
        {game.mode && (
          <div><span className="tag" style={tagStyle(modeColor, theme)}>{game.mode}</span></div>
        )}
        {game.risk && (
          <div><span className="tag" style={tagStyle(riskColor, theme)}>{game.risk} risk</span></div>
        )}
        {game.platform && <span className="tag-platform">{game.platform}</span>}
        {game.input && <span className="tag-platform">{game.input}</span>}
        {game.imageUrl && <img className="game-thumb" src={game.imageUrl} alt="" loading="lazy" />}
      </div>

      {editingNote ? (
        <div className="note-edit-wrap">
          <textarea
            className="note-textarea"
            value={noteVal}
            onChange={(e) => setNoteVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setEditingNote(false); setNoteVal(game.note || ""); }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote();
            }}
            autoFocus
          />
          <div style={{ display: "flex", gap: 5 }}>
            <button className="action-btn action-played" onClick={saveNote}>Save</button>
            <button className="action-btn" style={{ color: "var(--muted)", borderColor: "var(--border2)" }}
              onClick={() => { setEditingNote(false); setNoteVal(game.note || ""); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div
          className="game-note game-note-editable"
          onClick={() => { setNoteVal(game.note || ""); setEditingNote(true); }}
          title="Click to edit"
        >
          {game.note
            ? game.note
            : <span style={{ opacity: 0.25, fontStyle: "normal" }}>add note…</span>
          }
        </div>
      )}

      <div className="game-actions" style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 4 }}>
        {cat !== "played" && !isInbox && (
          <button className="action-btn action-played" onClick={() => onPlayed(game.id, cat)}>✓ Played</button>
        )}
        {!isInbox && (
          <select
            defaultValue={cat}
            onChange={(e) => { onMove(game.id, cat, e.target.value); e.currentTarget.value = cat; }}
          >
            {MOVE_CATS.filter((c) => c !== "played" && c !== "inbox").map((c) => (
              <option key={c} value={c} selected={c === cat}>{CAT_LABELS[c]}</option>
            ))}
          </select>
        )}
        <div style={{ display: "flex", gap: 4 }}>
          <button className="row-edit-btn" style={{ flex: 1 }} onClick={() => onEdit(game, cat)}>Edit</button>
          <button className="row-delete-btn" onClick={() => onDelete(game, cat)} title="Delete">✕</button>
        </div>
      </div>
    </div>
  );
}
