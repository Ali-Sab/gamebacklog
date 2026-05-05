import { useState } from "react";
import type { Game, Games } from "../../context/AppContext";
import { GameRow, CAT_LABELS } from "./GameRow";
import { GameModal } from "./GameModal";
import { Modal } from "../shared/Modal";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { useToast } from "../shared/Toast";

interface Props {
  games: Game[];
  cat: string;
  allGames: Games;
  sortBy: string;
  theme: string;
}

export function GameTable({ games, cat, theme }: Props) {
  const { moveGame, markPlayed, deleteGame, restoreGames, setNote, setRank, loadApp } = useApp();
  const { showToast } = useToast();
  const [editGame, setEditGame] = useState<{ game: Game; cat: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ game: Game; cat: string } | null>(null);

  const isInbox = cat === "inbox";
  const cols = isInbox ? "1fr 54px minmax(100px, auto) 1.6fr 110px" : "54px 1fr 54px minmax(100px, auto) 1.6fr 110px";
  const headers = isInbox ? ["Game", "Hours", "Mode", "Notes", ""] : ["#", "Game", "Hours", "Mode", "Notes", ""];

  async function handleMove(id: string, fromCat: string, toCat: string) {
    const result = await moveGame(id, fromCat, toCat);
    if (result) showToast(`Moved "${result.title}" to ${CAT_LABELS[toCat] || toCat}`, () => restoreGames(result.before));
    else showToast("Error moving game");
  }

  async function handlePlayed(id: string, fromCat: string) {
    const result = await markPlayed(id, fromCat);
    if (result) showToast(`Marked "${result.title}" as played`, () => restoreGames(result.before));
    else showToast("Error");
  }

  async function handleDelete(game: Game, gameCat: string) {
    setDeleteConfirm({ game, cat: gameCat });
  }

  async function confirmDelete() {
    if (!deleteConfirm) return;
    const result = await deleteGame(deleteConfirm.game.id, deleteConfirm.cat);
    setDeleteConfirm(null);
    if (result) showToast(`Deleted "${result.title}"`, () => restoreGames(result.before));
    else showToast("Error deleting game");
  }

  function handleSetRank(id: string, gameCat: string, newRank: number) {
    const result = setRank(id, gameCat, newRank);
    if (result) showToast(`Moved "${result.title}" to rank ${newRank}`, () => restoreGames(result.before));
  }

  if (games.length === 0) {
    return (
      <div className="game-table">
        <div className="empty-state">{isInbox ? "Nothing here yet." : "No games match"}</div>
      </div>
    );
  }

  return (
    <>
      <div className="game-table">
        <div className="table-header" style={{ gridTemplateColumns: cols }}>
          {headers.map((h) => <span key={h}>{h}</span>)}
        </div>
        {games.map((g, i) => (
          <GameRow
            key={g.id}
            game={g}
            index={i}
            cat={cat}
            cols={cols}
            theme={theme}
            isInbox={isInbox}
            onMove={handleMove}
            onPlayed={handlePlayed}
            onEdit={(game, gameCat) => setEditGame({ game, cat: gameCat })}
            onDelete={handleDelete}
            onSaveNote={setNote}
          />
        ))}
      </div>

      {editGame && (
        <GameModal
          title="Edit Game"
          sub={`Editing fields on "${editGame.game.title}"`}
          initial={editGame.game}
          maxRank={editGame.cat !== "inbox" ? (games.length) : undefined}
          onClose={() => setEditGame(null)}
          onSubmit={async (fields) => {
            if (!fields.title?.trim()) return false;
            const { rank, ...rest } = fields;
            const data = await api("PATCH", `/api/games/${editGame.game.id}`, rest);
            if (data.error) { showToast(`Error: ${data.error}`); return false; }
            if (rank !== undefined && rank !== editGame.game.rank) {
              handleSetRank(editGame.game.id, editGame.cat, rank);
            } else {
              await loadApp();
            }
            return true;
          }}
        />
      )}

      {deleteConfirm && (
        <Modal onClose={() => setDeleteConfirm(null)}>
          <div className="modal-title">Delete game</div>
          <div className="modal-sub">
            This permanently removes <strong>{deleteConfirm.game.title}</strong> from your library. You can undo from the toast.
          </div>
          <div className="modal-row">
            <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={confirmDelete} data-testid="confirm-delete-btn">Delete</button>
          </div>
        </Modal>
      )}
    </>
  );
}
