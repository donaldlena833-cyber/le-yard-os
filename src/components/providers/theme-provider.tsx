"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
}>({ theme: "light", toggleTheme: () => undefined });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("le-yard-theme");
    } catch {
      /* Keep appearance usable when storage is disabled. */
    }
    const nextTheme =
      (stored === "light" || stored === "dark" ? stored : null) ||
      (window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    const frame = window.requestAnimationFrame(() => {
      setTheme(nextTheme);
      document.documentElement.classList.toggle("dark", nextTheme === "dark");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const value = useMemo(
    () => ({
      theme,
      toggleTheme: () => {
        setTheme((current) => {
          const nextTheme = current === "light" ? "dark" : "light";
          document.documentElement.classList.toggle(
            "dark",
            nextTheme === "dark",
          );
          try {
            window.localStorage.setItem("le-yard-theme", nextTheme);
          } catch {
            /* The current theme still applies. */
          }
          return nextTheme;
        });
      },
    }),
    [theme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
