import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface Toast {
  id: number;
  msg: string;
  undoFn?: () => void;
}

interface ToastContextValue {
  showToast: (msg: string, undoFn?: () => void) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
let _nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((msg: string, undoFn?: () => void) => {
    const id = ++_nextId;
    setToasts((prev) => [...prev, { id, msg, undoFn }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {createPortal(
        <div id="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              <span>{t.msg}</span>
              {t.undoFn && (
                <button
                  onClick={() => {
                    t.undoFn!();
                    dismiss(t.id);
                  }}
                >
                  Undo
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
