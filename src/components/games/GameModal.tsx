import { useState } from "react";
import { Modal } from "../shared/Modal";
import type { Game } from "../../context/AppContext";

const MODES = ["", "atmospheric", "narrative", "detective", "tactical", "immersive", "action", "strategy", "puzzle", "rpg"];
const RISKS = ["", "low", "medium", "high"];
const PLATFORMS = ["", "pc", "ps5"];
const INPUTS = ["", "kbm", "ps5-controller", "xbox-controller"];

interface Props {
  title: string;
  sub: string;
  initial: Partial<Game>;
  maxRank?: number;
  onSubmit: (fields: Partial<Game>) => Promise<boolean>;
  onClose: () => void;
}

export function GameModal({ title, sub, initial, maxRank, onSubmit, onClose }: Props) {
  const [fields, setFields] = useState<Partial<Game>>({
    title: initial.title || "",
    mode: initial.mode || "",
    risk: initial.risk || "",
    hours: initial.hours || "",
    platform: initial.platform || "",
    input: initial.input || "",
    url: initial.url || "",
    imageUrl: initial.imageUrl || "",
    note: initial.note || "",
    rank: initial.rank,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function set(key: keyof Game, value: string) {
    setFields((f) => ({ ...f, [key]: value || undefined }));
  }

  async function save() {
    if (!fields.platform) { setError("Platform is required"); return; }
    if (!fields.input) { setError("Input is required"); return; }
    setError("");
    setLoading(true);
    const ok = await onSubmit({
      ...fields,
      title: (fields.title || "").trim(),
    });
    setLoading(false);
    if (ok !== false) onClose();
  }

  function sel(key: keyof Game, opts: string[], id?: string) {
    return (
      <select
        id={id}
        value={(fields[key] as string) || ""}
        onChange={(e) => set(key, e.target.value)}
        style={{ width: "100%", padding: "9px 10px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: "6px" }}
      >
        {opts.map((o) => <option key={o} value={o}>{o || "(none)"}</option>)}
      </select>
    );
  }

  return (
    <Modal onClose={onClose}>
      <div className="modal-title">{title}</div>
      <div className="modal-sub">{sub}</div>
      <div className="field">
        <label htmlFor="gm-title">Title</label>
        <input
          id="gm-title"
          data-testid="gm-title"
          value={fields.title || ""}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Game title"
          autoFocus
        />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ flex: 1 }}><label htmlFor="gm-mode">Mode</label>{sel("mode", MODES, "gm-mode")}</div>
        <div className="field" style={{ flex: 1 }}><label htmlFor="gm-risk">Risk</label>{sel("risk", RISKS, "gm-risk")}</div>
        <div className="field" style={{ width: 90 }}>
          <label htmlFor="gm-hours">Hours</label>
          <input id="gm-hours" value={fields.hours || ""} onChange={(e) => set("hours", e.target.value)} placeholder="10" />
        </div>
        {maxRank !== undefined && (
          <div className="field" style={{ width: 70 }}>
            <label htmlFor="gm-rank">Rank</label>
            <input
              id="gm-rank"
              type="number"
              min={1}
              max={maxRank}
              value={fields.rank ?? ""}
              onChange={(e) => setFields((f) => ({ ...f, rank: e.target.value ? parseInt(e.target.value, 10) : undefined }))}
            />
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ flex: 1 }}><label htmlFor="gm-platform">Platform</label>{sel("platform", PLATFORMS, "gm-platform")}</div>
        <div className="field" style={{ flex: 1 }}><label htmlFor="gm-input">Input</label>{sel("input", INPUTS, "gm-input")}</div>
      </div>
      <div className="field">
        <label htmlFor="gm-url">Store URL (Steam, or PlayStation Store)</label>
        <input id="gm-url" value={fields.url || ""} onChange={(e) => set("url", e.target.value)} placeholder="https://store.steampowered.com/app/…" />
      </div>
      <div className="field">
        <label htmlFor="gm-image-url">Cover Image URL (optional)</label>
        <input id="gm-image-url" value={fields.imageUrl || ""} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://…" />
      </div>
      <div className="field">
        <label htmlFor="gm-note">Note</label>
        <textarea id="gm-note" value={fields.note || ""} onChange={(e) => set("note", e.target.value)} style={{ minHeight: 60 }} />
      </div>
      {error && <div className="error-msg" data-testid="gm-error">{error}</div>}
      <div className="modal-row">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-gold" onClick={save} disabled={loading} data-testid="gm-save">Save</button>
      </div>
    </Modal>
  );
}
