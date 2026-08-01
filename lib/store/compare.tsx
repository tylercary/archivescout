"use client";

import * as React from "react";
import type { Listing } from "@/lib/marketplaces/types";
import { useLocalStorage } from "./use-local-storage";

export const MAX_COMPARE = 4;

interface CompareContextValue {
  items: Listing[];
  ids: Set<string>;
  isComparing: (id: string) => boolean;
  canAdd: boolean;
  toggle: (listing: Listing) => boolean; // returns false if rejected (full)
  remove: (id: string) => void;
  clear: () => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  hydrated: boolean;
}

const CompareContext = React.createContext<CompareContextValue | null>(null);

const STORAGE_KEY = "archivescout:compare";

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems, hydrated] = useLocalStorage<Listing[]>(
    STORAGE_KEY,
    [],
  );
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const ids = React.useMemo(() => new Set(items.map((i) => i.id)), [items]);

  const toggle = React.useCallback(
    (listing: Listing): boolean => {
      let accepted = true;
      setItems((prev) => {
        if (prev.some((i) => i.id === listing.id)) {
          return prev.filter((i) => i.id !== listing.id);
        }
        if (prev.length >= MAX_COMPARE) {
          accepted = false;
          return prev;
        }
        return [...prev, listing];
      });
      return accepted;
    },
    [setItems],
  );

  const remove = React.useCallback(
    (id: string) => setItems((prev) => prev.filter((i) => i.id !== id)),
    [setItems],
  );

  const clear = React.useCallback(() => setItems([]), [setItems]);

  const value = React.useMemo<CompareContextValue>(
    () => ({
      items,
      ids,
      isComparing: (id) => ids.has(id),
      canAdd: items.length < MAX_COMPARE,
      toggle,
      remove,
      clear,
      drawerOpen,
      setDrawerOpen,
      hydrated,
    }),
    [items, ids, toggle, remove, clear, drawerOpen, hydrated],
  );

  return (
    <CompareContext.Provider value={value}>{children}</CompareContext.Provider>
  );
}

export function useCompare() {
  const ctx = React.useContext(CompareContext);
  if (!ctx) throw new Error("useCompare must be used within CompareProvider");
  return ctx;
}
