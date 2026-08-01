import type { Database } from "@/lib/supabase/types";
import type { getSupabaseServerClient } from "@/lib/supabase/server";
import type { SearchFilters } from "@/lib/marketplaces/types";
import {
  isSameSearch,
  toSavedSearchPayload,
  type SavedSearchPayload,
} from "./serializer";
import type { NotificationType } from "./notification-scheduler";

/**
 * Server-side saved-search operations.
 *
 * SECURITY: every method derives the owner from the AUTHENTICATED session via
 * `auth.getUser()` — a user id is never accepted from the caller. RLS enforces
 * the same rule at the database level (verified by scripts/verify-supabase.mjs),
 * so a bug here still cannot leak another user's rows; the two are independent
 * layers, deliberately.
 */

export interface SavedSearchRecord {
  id: string;
  name: string;
  query: string;
  marketplaces: string[];
  filters: SearchFilters;
  sort: string;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  notificationsEnabled: boolean;
  notificationTypes: NotificationType[];
}

/** Exactly the client the server factory produces — avoids generic drift. */
type Client = NonNullable<ReturnType<typeof getSupabaseServerClient>>;
type Row = Database["public"]["Tables"]["saved_searches"]["Row"];
type Insert = Database["public"]["Tables"]["saved_searches"]["Insert"];
type Update = Database["public"]["Tables"]["saved_searches"]["Update"];

function toRecord(row: Row): SavedSearchRecord {
  return {
    id: row.id,
    name: row.name || row.query || "Saved search",
    query: row.query,
    marketplaces: row.marketplaces,
    filters: (row.filters ?? {}) as SearchFilters,
    sort: row.sort,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckedAt: row.last_checked_at,
    notificationsEnabled: row.is_notification_enabled,
    notificationTypes: (row.notification_types ?? []) as NotificationType[],
  };
}

/** Payload view of a stored record, for identity comparison. */
export function recordPayload(record: SavedSearchRecord): SavedSearchPayload {
  return {
    query: record.query,
    marketplaces: record.marketplaces,
    filters: record.filters,
    sort: record.sort,
  };
}

export class SavedSearchService {
  constructor(private readonly client: Client) {}

  /** The authenticated user id, verified against the auth server. */
  private async requireUserId(): Promise<string> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) throw new UnauthorizedError();
    return data.user.id;
  }

  async list(): Promise<SavedSearchRecord[]> {
    await this.requireUserId(); // 401 rather than an empty list when signed out
    const { data, error } = await this.client
      .from("saved_searches")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(toRecord);
  }

  async get(id: string): Promise<SavedSearchRecord | null> {
    await this.requireUserId();
    const { data, error } = await this.client
      .from("saved_searches")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? toRecord(data) : null;
  }

  /**
   * The saved search matching this exact normalized search, if any.
   * Compares full search IDENTITY (query + filters + marketplaces + sort), so
   * "chanel runners" and "chanel runners + size 13" are distinct.
   */
  async findMatching(payload: SavedSearchPayload): Promise<SavedSearchRecord | null> {
    const all = await this.list();
    return all.find((r) => isSameSearch(recordPayload(r), payload)) ?? null;
  }

  /**
   * Create, or return the existing search when an identical one is already
   * saved. Duplicate prevention is enforced twice: an explicit pre-check, and
   * the database's unique index (23505) for the concurrent case.
   */
  async create(input: {
    payload: SavedSearchPayload;
    name: string;
    notificationsEnabled?: boolean;
    notificationTypes?: NotificationType[];
  }): Promise<{ record: SavedSearchRecord; duplicate: boolean }> {
    const userId = await this.requireUserId();

    const existing = await this.findMatching(input.payload);
    if (existing) return { record: existing, duplicate: true };

    const { data, error } = await this.client
      .from("saved_searches")
      .insert({
        user_id: userId,
        name: input.name,
        query: input.payload.query,
        marketplaces: input.payload.marketplaces,
        filters: input.payload.filters as Insert["filters"],
        sort: input.payload.sort,
        is_notification_enabled: input.notificationsEnabled ?? false,
        notification_types: input.notificationTypes ?? [],
      } satisfies Insert)
      .select()
      .single();

    if (error) {
      // 23505 = unique violation: the identity index caught a race.
      if (error.code === "23505") {
        const dupe = await this.findMatching(input.payload);
        if (dupe) return { record: dupe, duplicate: true };
      }
      throw error;
    }
    return { record: toRecord(data), duplicate: false };
  }

  /** Rename / toggle alerts. Only the owner's row is reachable (RLS). */
  async update(
    id: string,
    patch: {
      name?: string;
      notificationsEnabled?: boolean;
      notificationTypes?: NotificationType[];
    },
  ): Promise<SavedSearchRecord | null> {
    await this.requireUserId();
    const row: Update = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.notificationsEnabled !== undefined)
      row.is_notification_enabled = patch.notificationsEnabled;
    if (patch.notificationTypes !== undefined)
      row.notification_types = patch.notificationTypes;
    if (Object.keys(row).length === 0) return this.get(id);

    const { data, error } = await this.client
      .from("saved_searches")
      .update(row)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data ? toRecord(data) : null;
  }

  /** Returns false when nothing was deleted (not found, or not the owner's). */
  async delete(id: string): Promise<boolean> {
    await this.requireUserId();
    const { data, error } = await this.client
      .from("saved_searches")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "UnauthorizedError";
  }
}

/** Convenience: build the payload the service stores from live search params. */
export { toSavedSearchPayload };
