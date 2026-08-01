"use client";

import * as React from "react";
import type { Marketplace } from "@/lib/marketplaces/types";
import type { RecentSearch, SavedSearch } from "@/types";
import { useLocalStorage } from "./use-local-storage";

interface SearchesContextValue {
  recent: RecentSearch[];
  saved: SavedSearch[];
  addRecent: (query: string, marketplaces: Marketplace[]) => void;
  clearRecent: () => void;
  saveSearch: (search: Omit<SavedSearch, "id" | "createdAt">) => void;
  removeSaved: (id: string) => void;
  togglePriceAlert: (id: string) => void;
  isSaved: (query: string) => boolean;
  hydrated: boolean;
}

const SearchesContext = React.createContext<SearchesContextValue | null>(null);

const RECENT_KEY = "archivescout:recent-searches";
const SAVED_KEY = "archivescout:saved-searches";
const MAX_RECENT = 8;

/** Stable-ish id generator without Math.random for SSR-safety concerns. */
function makeId(seed: string): string {
  return `${seed.replace(/\s+/g, "-").toLowerCase().slice(0, 24)}-${Date.now()}`;
}

export function SearchesProvider({ children }: { children: React.ReactNode }) {
  const [recent, setRecent, h1] = useLocalStorage<RecentSearch[]>(RECENT_KEY, []);
  const [saved, setSaved, h2] = useLocalStorage<SavedSearch[]>(SAVED_KEY, []);

  const addRecent = React.useCallback(
    (query: string, marketplaces: Marketplace[]) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      setRecent((prev) => {
        const deduped = prev.filter(
          (r) => r.query.toLowerCase() !== trimmed.toLowerCase(),
        );
        return [
          { query: trimmed, marketplaces, at: new Date().toISOString() },
          ...deduped,
        ].slice(0, MAX_RECENT);
      });
    },
    [setRecent],
  );

  const clearRecent = React.useCallback(() => setRecent([]), [setRecent]);

  const saveSearch = React.useCallback(
    (search: Omit<SavedSearch, "id" | "createdAt">) => {
      setSaved((prev) => {
        // Replace an existing saved search with the same query.
        const filtered = prev.filter(
          (s) => s.query.toLowerCase() !== search.query.toLowerCase(),
        );
        return [
          {
            ...search,
            id: makeId(search.query || "search"),
            createdAt: new Date().toISOString(),
          },
          ...filtered,
        ];
      });
    },
    [setSaved],
  );

  const removeSaved = React.useCallback(
    (id: string) => setSaved((prev) => prev.filter((s) => s.id !== id)),
    [setSaved],
  );

  const togglePriceAlert = React.useCallback(
    (id: string) =>
      setSaved((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, priceAlert: !s.priceAlert } : s,
        ),
      ),
    [setSaved],
  );

  const value = React.useMemo<SearchesContextValue>(
    () => ({
      recent,
      saved,
      addRecent,
      clearRecent,
      saveSearch,
      removeSaved,
      togglePriceAlert,
      isSaved: (query) =>
        saved.some((s) => s.query.toLowerCase() === query.trim().toLowerCase()),
      hydrated: h1 && h2,
    }),
    [recent, saved, addRecent, clearRecent, saveSearch, removeSaved, togglePriceAlert, h1, h2],
  );

  return (
    <SearchesContext.Provider value={value}>
      {children}
    </SearchesContext.Provider>
  );
}

export function useSearches() {
  const ctx = React.useContext(SearchesContext);
  if (!ctx) throw new Error("useSearches must be used within SearchesProvider");
  return ctx;
}
