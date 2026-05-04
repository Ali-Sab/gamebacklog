import { useState } from "react";
import { useApp, type ProfileSection } from "../../context/AppContext";

interface SectionCardProps {
  section: ProfileSection;
  onEdit: () => void;
}

function SectionCard({ section, onEdit }: SectionCardProps) {
  return (
    <div className="profile-section-card">
      <div className="profile-section-header">
        <div className="profile-section-name">{section.name}</div>
        <div className="profile-section-actions">
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }} onClick={onEdit}>Edit</button>
        </div>
      </div>
      <div className="profile-body">{section.text}</div>
    </div>
  );
}

interface EditorCardProps {
  section: ProfileSection;
  onSave: (name: string, text: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}

function EditorCard({ section, onSave, onCancel, onDelete }: EditorCardProps) {
  const [name, setName] = useState(section.name);
  const [text, setText] = useState(section.text);

  return (
    <div className="profile-section-card">
      <div className="profile-section-edit">
        <input
          className="profile-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="SECTION NAME"
          autoFocus
        />
        <textarea
          className="profile-text-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="profile-section-edit-btns">
          <button className="btn btn-gold" style={{ fontSize: 12, padding: "5px 12px" }} onClick={() => onSave(name, text)}>Save</button>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 12px" }} onClick={onCancel}>Cancel</button>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 12px", color: "var(--red)", marginLeft: "auto" }} onClick={onDelete}>Delete</button>
        </div>
      </div>
    </div>
  );
}

export function ProfileTab() {
  const { state, saveProfile } = useApp();
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const sections = Array.isArray(state.profile) ? state.profile : [];

  async function handleSave(i: number, name: string, text: string) {
    if (!name.trim()) return;
    const updated = [...sections];
    updated[i] = { name, text };
    await saveProfile(updated);
    setEditingIdx(null);
  }

  async function handleDelete(i: number) {
    if (!confirm("Delete this section?")) return;
    const updated = [...sections];
    updated.splice(i, 1);
    await saveProfile(updated);
    setEditingIdx(null);
  }

  async function addSection() {
    const updated = [...sections, { name: "NEW SECTION", text: "" }];
    await saveProfile(updated);
    setEditingIdx(updated.length - 1);
  }

  return (
    <div data-testid="tab-profile">
      <div className="profile-header">
        <div>
          <div className="settings-title">Taste Profile</div>
          <div className="profile-meta">Used by Claude to recommend and sort your games</div>
        </div>
      </div>
      <div className="profile-view">
        {sections.map((s, i) =>
          editingIdx === i ? (
            <EditorCard
              key={i}
              section={s}
              onSave={(name, text) => handleSave(i, name, text)}
              onCancel={() => setEditingIdx(null)}
              onDelete={() => handleDelete(i)}
            />
          ) : (
            <SectionCard key={i} section={s} onEdit={() => setEditingIdx(i)} />
          )
        )}
        {editingIdx === null && (
          <div className="profile-add-section">
            <button className="btn btn-ghost" onClick={addSection}>+ Add Section</button>
          </div>
        )}
      </div>
    </div>
  );
}
