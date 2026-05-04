import React, { useEffect, useState } from "react";

export const THEMES: Record<string, Record<string, string>> = {
  void: {
    label: "Void",
    "--bg": "#0d0d14", "--surface": "#13131e", "--border": "#1e1e30", "--border2": "#2a2a42",
    "--text": "#eae8f6", "--muted": "#7a7898", "--sub": "#9390b0",
    "--gold": "#a78bfa", "--red": "#f87171", "--green": "#86efac", "--blue": "#7dd3fc",
    "--table-head": "#0f0f18", "--row-hover": "#17172a", "--secret-bg": "#09090f",
    "--btn-gold-text": "#0d0d14", "--note-color": "#3e3c58",
  },
  dusk: {
    label: "Dusk",
    "--bg": "#111118", "--surface": "#1c1c28", "--border": "#272738", "--border2": "#333350",
    "--text": "#ece9f8", "--muted": "#8e8aac", "--sub": "#a8a4c4",
    "--gold": "#b49dfc", "--red": "#fc8080", "--green": "#93f2b8", "--blue": "#8adafc",
    "--table-head": "#0e0e1a", "--row-hover": "#1f1f30", "--secret-bg": "#0a0a12",
    "--btn-gold-text": "#111118", "--note-color": "#44425e",
  },
  ash: {
    label: "Ash",
    "--bg": "#0f0f0f", "--surface": "#141414", "--border": "#1e1e1e", "--border2": "#252525",
    "--text": "#f0ede6", "--muted": "#706e6b", "--sub": "#8a8784",
    "--gold": "#e8c547", "--red": "#e87c7c", "--green": "#b8d47e", "--blue": "#7eb8d4",
    "--table-head": "#0b0b0b", "--row-hover": "#181818", "--secret-bg": "#080808",
    "--btn-gold-text": "#0f0f0f", "--note-color": "#605e58",
  },
  light: {
    label: "Light",
    "--bg": "#f1f2f5", "--surface": "#f8f9fb", "--border": "#dde0e8", "--border2": "#c4c8d4",
    "--text": "#1a1d26", "--muted": "#6b7280", "--sub": "#4b5563",
    "--gold": "#5548c8", "--red": "#b83232", "--green": "#1a6b40", "--blue": "#2a5fa8",
    "--table-head": "#e8eaef", "--row-hover": "#edeef2", "--secret-bg": "#e4e6ec",
    "--btn-gold-text": "#ffffff", "--note-color": "#8b92a0",
  },
};

export function tagColor(
  map: Record<string, string>,
  mapLight: Record<string, string>,
  key: string,
  theme: string,
): string {
  const m = theme === "light" ? mapLight : map;
  return m[key] || (theme === "light" ? "#555" : "#888");
}

export function tagStyle(color: string, theme: string): React.CSSProperties {
  return {
    background: `${color}18`,
    color,
    border: `1px solid ${color}${theme === "light" ? "55" : "28"}`,
  };
}

export function useTheme() {
  const [theme, setThemeState] = useState<string>(
    () => localStorage.getItem("theme") || "void"
  );

  useEffect(() => {
    const t = THEMES[theme] || THEMES.void;
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(t)) {
      if (k !== "label") root.setProperty(k, v);
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  function setTheme(name: string) {
    setThemeState(name);
  }

  return { theme, setTheme };
}
