"use client";

import * as React from "react";
import type { Listing } from "@/lib/marketplaces/types";
import type { FavoriteItem } from "@/types";
import { useLocalStorage } from "./use-local-storage";

interface FavoritesContextValue {
  favorites: FavoriteItem[];
  ids: Set<string>;
  isFavorite: (id: string) => boolean;
  toggle: (listing: Listing) => void;
  remove: (id: string) => void;
  clear: () => void;
  hydrated: boolean;
}

const FavoritesContext = React.createContext<FavoritesContextValue | null>(null);

const STORAGE_KEY = "archivescout:favorites";

export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites, hydrated] = useLocalStorage<FavoriteItem[]>(
    STORAGE_KEY,
    [],
  );

  const ids = React.useMemo(
    () => new Set(favorites.map((f) => f.listing.id)),
    [favorites],
  );

  const toggle = React.useCallback(
    (listing: Listing) => {
      setFavorites((prev) => {
        if (prev.some((f) => f.listing.id === listing.id)) {
          return prev.filter((f) => f.listing.id !== listing.id);
        }
        return [{ listing, savedAt: new Date().toISOString() }, ...prev];
      });
    },
    [setFavorites],
  );

  const remove = React.useCallback(
    (id: string) =>
      setFavorites((prev) => prev.filter((f) => f.listing.id !== id)),
    [setFavorites],
  );

  const clear = React.useCallback(() => setFavorites([]), [setFavorites]);

  const value = React.useMemo<FavoritesContextValue>(
    () => ({
      favorites,
      ids,
      isFavorite: (id) => ids.has(id),
      toggle,
      remove,
      clear,
      hydrated,
    }),
    [favorites, ids, toggle, remove, clear, hydrated],
  );

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const ctx = React.useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites must be used within FavoritesProvider");
  return ctx;
}
