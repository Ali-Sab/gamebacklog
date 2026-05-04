import { Modal } from "./Modal";

interface Props {
  codes: string[];
  message: string;
  onClose: () => void;
  onLogout?: () => void;
}

export function RecoveryCodesModal({ codes, message, onClose, onLogout }: Props) {
  return (
    <Modal onClose={onClose}>
      <div className="modal-title">Recovery Codes</div>
      <div className="modal-sub">{message}</div>
      <div className="recovery-codes" style={{ margin: "12px 0" }}>
        {codes.map((c) => (
          <div key={c} className="recovery-code">{c}</div>
        ))}
      </div>
      <div style={{ fontSize: "12px", color: "var(--red)", marginBottom: "16px" }}>
        These won't be shown again. Each code works once.
      </div>
      <div className="modal-row">
        {onLogout && (
          <button className="btn btn-gold" onClick={() => { onClose(); onLogout(); }}>
            Saved — Log Out
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>I've saved them</button>
      </div>
    </Modal>
  );
}
