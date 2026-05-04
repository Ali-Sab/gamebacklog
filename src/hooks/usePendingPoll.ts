import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export function usePendingPoll(active: boolean, intervalMs = 30000) {
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function poll() {
    if (!active) return;
    try {
      const items = await api("GET", "/api/pending");
      if (Array.isArray(items)) setCount(items.length);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!active) { setCount(0); return; }
    poll();
    timerRef.current = setInterval(poll, intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return count;
}
