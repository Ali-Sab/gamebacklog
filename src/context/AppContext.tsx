import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  ReactNode,
} from "react";
import { api } from "../api";

export interface Game {
  id: string;
  title: string;
  rank?: number;
  genre?: string;
  risk?: string;
  hours?: string;
  note?: string;
  playedDate?: string;
  url?: string;
  platform?: string;
  input?: string;
  imageUrl?: string;
  category?: string;
}

export interface ProfileSection {
  name: string;
  text: string;
}

export interface PendingItem {
  id: string;
  type: string;
  status: string;
  reason: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
}

export type Games = Record<string, Game[]>;

interface AppState {
  games: Games;
  profile: ProfileSection[];
  pendingItems: PendingItem[];
  activeCat: string;
  genreFilter: string | null;
  riskFilter: string | null;
  sortBy: string;
  globalSearch: string;
  loaded: boolean;
}

type AppAction =
  | { type: "LOADED"; games: Games; profile: ProfileSection[]; pending: PendingItem[] }
  | { type: "SET_GAMES"; games: Games }
  | { type: "SET_PROFILE"; profile: ProfileSection[] }
  | { type: "SET_PENDING"; pending: PendingItem[] }
  | { type: "SET_CAT"; cat: string }
  | { type: "SET_GENRE_FILTER"; genre: string | null }
  | { type: "SET_RISK_FILTER"; risk: string | null }
  | { type: "SET_SORT"; sortBy: string }
  | { type: "SET_SEARCH"; query: string };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "LOADED":
      return { ...state, games: action.games, profile: action.profile, pendingItems: action.pending, loaded: true };
    case "SET_GAMES":
      return { ...state, games: action.games };
    case "SET_PROFILE":
      return { ...state, profile: action.profile };
    case "SET_PENDING":
      return { ...state, pendingItems: action.pending };
    case "SET_CAT":
      return {
        ...state, activeCat: action.cat,
        genreFilter: null, riskFilter: null,
        sortBy: action.cat === "played" ? "playedDate" : "rank",
      };
    case "SET_GENRE_FILTER":
      return { ...state, genreFilter: action.genre };
    case "SET_RISK_FILTER":
      return { ...state, riskFilter: action.risk };
    case "SET_SORT":
      return { ...state, sortBy: action.sortBy };
    case "SET_SEARCH":
      return { ...state, globalSearch: action.query };
    default:
      return state;
  }
}

const initial: AppState = {
  games: {},
  profile: [],
  pendingItems: [],
  activeCat: "queue",
  genreFilter: null,
  riskFilter: null,
  sortBy: "rank",
  globalSearch: "",
  loaded: false,
};

interface AppContextValue {
  state: AppState;
  loadApp: () => Promise<void>;
  loadPending: () => Promise<void>;
  setActiveCat: (cat: string) => void;
  setGenreFilter: (genre: string | null) => void;
  setRiskFilter: (risk: string | null) => void;
  setSortBy: (s: string) => void;
  setGlobalSearch: (q: string) => void;
  moveGame: (id: string, fromCat: string, toCat: string) => Promise<{ before: Games; title: string } | null>;
  markPlayed: (id: string, fromCat: string) => Promise<{ before: Games; title: string } | null>;
  deleteGame: (id: string, cat: string) => Promise<{ before: Games; title: string } | null>;
  restoreGames: (before: Games) => void;
  setNote: (id: string, cat: string, note: string) => Promise<void>;
  setRank: (id: string, cat: string, newRank: number) => { before: Games; title: string } | null;
  approvePending: (id: string) => Promise<void>;
  rejectPending: (id: string) => Promise<void>;
  approveAll: () => Promise<void>;
  saveProfile: (profile: ProfileSection[]) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);

  const loadApp = useCallback(async () => {
    const [data, pending] = await Promise.all([
      api("GET", "/api/data"),
      api("GET", "/api/pending"),
    ]);
    dispatch({
      type: "LOADED",
      games: (data.games as Games) || {},
      profile: (data.profile as ProfileSection[]) || [],
      pending: Array.isArray(pending) ? (pending as PendingItem[]) : [],
    });
  }, []);

  const loadPending = useCallback(async () => {
    const items = await api("GET", "/api/pending");
    if (Array.isArray(items)) dispatch({ type: "SET_PENDING", pending: items as PendingItem[] });
  }, []);

  function snapshot(games: Games): Games {
    return JSON.parse(JSON.stringify(games));
  }

  const moveGame = useCallback(async (id: string, fromCat: string, toCat: string) => {
    if (fromCat === toCat) return null;
    const game = (state.games[fromCat] || []).find((g) => g.id === id);
    if (!game) return null;
    const before = snapshot(state.games);
    const data = await api("POST", `/api/games/${id}/move`, { category: toCat });
    if (data.error) return null;
    const newGames = { ...state.games };
    newGames[fromCat] = newGames[fromCat].filter((g) => g.id !== id);
    newGames[toCat] = [...(newGames[toCat] || []), data.game as Game];
    dispatch({ type: "SET_GAMES", games: newGames });
    return { before, title: game.title };
  }, [state.games]);

  const markPlayed = useCallback(async (id: string, fromCat: string) => {
    const game = (state.games[fromCat] || []).find((g) => g.id === id);
    if (!game) return null;
    const before = snapshot(state.games);
    const data = await api("POST", `/api/games/${id}/played`);
    if (data.error) return null;
    const newGames = { ...state.games };
    newGames[fromCat] = newGames[fromCat].filter((g) => g.id !== id);
    newGames.played = [...(newGames.played || []), data.game as Game];
    dispatch({ type: "SET_GAMES", games: newGames });
    return { before, title: game.title };
  }, [state.games]);

  const deleteGame = useCallback(async (id: string, cat: string) => {
    const game = (state.games[cat] || []).find((g) => g.id === id);
    if (!game) return null;
    const before = snapshot(state.games);
    const data = await api("DELETE", `/api/games/${id}`);
    if (data.error) return null;
    const newGames = { ...state.games };
    newGames[cat] = newGames[cat].filter((g) => g.id !== id);
    dispatch({ type: "SET_GAMES", games: newGames });
    return { before, title: game.title };
  }, [state.games]);

  const restoreGames = useCallback((before: Games) => {
    dispatch({ type: "SET_GAMES", games: before });
    api("POST", "/api/data", { games: before }).catch(() => {});
  }, []);

  const setNote = useCallback(async (id: string, cat: string, note: string) => {
    const data = await api("PATCH", `/api/games/${id}`, { note });
    if (!data.error) {
      const newGames = { ...state.games };
      newGames[cat] = (newGames[cat] || []).map((g) => g.id === id ? { ...g, note } : g);
      dispatch({ type: "SET_GAMES", games: newGames });
    }
  }, [state.games]);

  const setRank = useCallback((id: string, cat: string, newRank: number) => {
    if (!Number.isFinite(newRank) || newRank < 1) return null;
    const list = [...(state.games[cat] || [])].sort(
      (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)
    );
    const idx = list.findIndex((g) => g.id === id);
    if (idx === -1) return null;
    const before = snapshot(state.games);
    const target = Math.min(newRank, list.length);
    if (target === idx + 1) return null;
    const [moved] = list.splice(idx, 1);
    list.splice(target - 1, 0, moved);
    list.forEach((g, i) => { g.rank = i + 1; });
    const newGames = { ...state.games, [cat]: list };
    dispatch({ type: "SET_GAMES", games: newGames });
    api("POST", "/api/data", { games: newGames }).catch(() => {});
    return { before, title: moved.title };
  }, [state.games]);

  const approvePending = useCallback(async (id: string) => {
    const res = await api("POST", `/api/pending/${id}/approve`);
    const [data] = await Promise.all([
      api("GET", "/api/data"),
    ]);
    if (data.games) dispatch({ type: "SET_GAMES", games: data.games as Games });
    if (data.profile) dispatch({ type: "SET_PROFILE", profile: data.profile as ProfileSection[] });
    if (Array.isArray(res)) dispatch({ type: "SET_PENDING", pending: res as PendingItem[] });
  }, []);

  const rejectPending = useCallback(async (id: string) => {
    const res = await api("POST", `/api/pending/${id}/reject`);
    if (Array.isArray(res)) dispatch({ type: "SET_PENDING", pending: res as PendingItem[] });
  }, []);

  const approveAll = useCallback(async () => {
    await api("POST", "/api/pending/approve-all");
    const [data, pending] = await Promise.all([
      api("GET", "/api/data"),
      api("GET", "/api/pending"),
    ]);
    if (data.games) dispatch({ type: "SET_GAMES", games: data.games as Games });
    if (data.profile) dispatch({ type: "SET_PROFILE", profile: data.profile as ProfileSection[] });
    dispatch({ type: "SET_PENDING", pending: Array.isArray(pending) ? (pending as PendingItem[]) : [] });
  }, []);

  const saveProfile = useCallback(async (profile: ProfileSection[]) => {
    await api("POST", "/api/data", { profile });
    dispatch({ type: "SET_PROFILE", profile });
  }, []);

  return (
    <AppContext.Provider
      value={{
        state,
        loadApp,
        loadPending,
        setActiveCat: (cat) => dispatch({ type: "SET_CAT", cat }),
        setGenreFilter: (genre) => dispatch({ type: "SET_GENRE_FILTER", genre }),
        setRiskFilter: (risk) => dispatch({ type: "SET_RISK_FILTER", risk }),
        setSortBy: (sortBy) => dispatch({ type: "SET_SORT", sortBy }),
        setGlobalSearch: (query) => dispatch({ type: "SET_SEARCH", query }),
        moveGame,
        markPlayed,
        deleteGame,
        restoreGames,
        setNote,
        setRank,
        approvePending,
        rejectPending,
        approveAll,
        saveProfile,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
