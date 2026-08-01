"use client";

import * as React from "react";
import { useAuth } from "@/lib/supabase/auth-context";
import type { SavedSearchRecord } from "./service";
import type { NotificationType } from "./notification-scheduler";
import { isSameSearch, type SavedSearchPayload } from "./serializer";

/**
 * Client access to the signed-in user's saved searches.
 *
 * All writes go through /api/saved-searches, where identity is established
 * from the session — the browser never sends a user id. Loads once per
 * sign-in and keeps a local copy so the search page can answer "is this
 * already saved?" without a request per keystroke.
 */

interface SavedSearchesState {
  searches: SavedSearchRecord[];
  loading: boolean;
  /** Auth is configured AND a user is signed in. */
  available: boolean;
  save: (input: {
    searchQueryString: string;
    name: string;
    notificationTypes: NotificationType[];
  }) => Promise<{ record: SavedSearchRecord; duplicate: boolean }>;
  update: (
    id: string,
    patch: { name?: string; notificationTypes?: NotificationType[] },
  ) => Promise<SavedSearchRecord | null>;
  remove: (id: string) => Promise<boolean>;
  /** The saved search matching this exact normalized search, if any. */
  findMatching: (payload: SavedSearchPayload) => SavedSearchRecord | null;
  refresh: () => Promise<void>;
}

const Ctx = React.createContext<SavedSearchesState | null>(null);

export function SavedSearchesProvider({ children }: { children: React.ReactNode }) {
  const { user, configured } = useAuth();
  const [searches, setSearches] = React.useState<SavedSearchRecord[]>([]);
  const [loading, setLoading] = React.useState(false);

  const available = configured && Boolean(user);

  const refresh = React.useCallback(async () => {
    if (!available) {
      setSearches([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/saved-searches");
      if (res.ok) {
        const body = (await res.json()) as { savedSearches: SavedSearchRecord[] };
        setSearches(body.savedSearches ?? []);
      } else {
        setSearches([]);
      }
    } catch {
      setSearches([]);
    } finally {
      setLoading(false);
    }
  }, [available]);

  // Reload whenever the signed-in identity changes (including sign-out).
  React.useEffect(() => {
    void refresh();
  }, [refresh, user?.id]);

  const save: SavedSearchesState["save"] = React.useCallback(
    async ({ searchQueryString, name, notificationTypes }) => {
      const res = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          searchQueryString,
          name,
          notificationsEnabled: notificationTypes.length > 0,
          notificationTypes,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Save failed");
      const body = (await res.json()) as { savedSearch: SavedSearchRecord; duplicate: boolean };
      setSearches((prev) => {
        const rest = prev.filter((s) => s.id !== body.savedSearch.id);
        return [body.savedSearch, ...rest];
      });
      return { record: body.savedSearch, duplicate: body.duplicate };
    },
    [],
  );

  const update: SavedSearchesState["update"] = React.useCallback(
    async (id, patch) => {
      const res = await fetch(`/api/saved-searches/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...patch,
          ...(patch.notificationTypes
            ? { notificationsEnabled: patch.notificationTypes.length > 0 }
            : {}),
        }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { savedSearch: SavedSearchRecord };
      setSearches((prev) =>
        prev.map((s) => (s.id === id ? body.savedSearch : s)),
      );
      return body.savedSearch;
    },
    [],
  );

  const remove: SavedSearchesState["remove"] = React.useCallback(async (id) => {
    const res = await fetch(`/api/saved-searches/${id}`, { method: "DELETE" });
    if (!res.ok) return false;
    // Update immediately — no page reload.
    setSearches((prev) => prev.filter((s) => s.id !== id));
    return true;
  }, []);

  const findMatching: SavedSearchesState["findMatching"] = React.useCallback(
    (payload) =>
      searches.find((s) =>
        isSameSearch(
          {
            query: s.query,
            marketplaces: s.marketplaces,
            filters: s.filters,
            sort: s.sort,
          },
          payload,
        ),
      ) ?? null,
    [searches],
  );

  const value = React.useMemo<SavedSearchesState>(
    () => ({ searches, loading, available, save, update, remove, findMatching, refresh }),
    [searches, loading, available, save, update, remove, findMatching, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSavedSearches(): SavedSearchesState {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useSavedSearches must be used within SavedSearchesProvider");
  return ctx;
}
