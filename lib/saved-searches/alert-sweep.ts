import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { runSearch } from "@/lib/search/engine";
import {
  fromSavedSearchPayload,
  toSearchUrl,
  type SavedSearchPayload,
} from "./serializer";
import { detectEvents, type DetectedEvent, type SeenListing } from "./alert-detection";
import {
  NoopDeliveryProvider,
  ResendDeliveryProvider,
  type AlertDeliveryProvider,
  type AlertEmailListing,
  type SavedSearchAlertEmail,
} from "./alert-delivery";
import { alertsReadiness } from "./alerts-config";

/**
 * The saved-search alert sweep.
 *
 * Runs SERVER-SIDE ONLY under the service role, which bypasses RLS — that key
 * must never reach a browser bundle. It replays each saved search through the
 * SAME `runSearch` engine the UI uses (via `fromSavedSearchPayload`), so alerts
 * inherit every filter fix automatically and there is no second search
 * implementation to drift.
 *
 * Safety properties:
 * - bounded: MAX_SEARCHES per run, MAX_PAGES per search
 * - leased: a search being processed is invisible to an overlapping run
 * - idempotent: events collide on a unique dedupe_key rather than re-sending
 */

const MAX_SEARCHES_PER_RUN = 50;
/** Pages of results replayed per search. Alerts care about the freshest page,
 *  not the whole corpus — this caps API spend and runtime. */
const MAX_PAGES_PER_SEARCH = 1;
const LEASE_MINUTES = 10;

export interface SweepSummary {
  runId: string;
  searchesProcessed: number;
  searchesSkipped: number;
  listingsCompared: number;
  newListings: number;
  priceDrops: number;
  eventsCreated: number;
  duplicatesSuppressed: number;
  emailsSent: number;
  marketplaceFailures: string[];
  errors: string[];
  durationMs: number;
}

type ServiceClient = SupabaseClient<Database>;

/** Service-role client. Throws rather than silently running without privileges. */
export function createServiceClient(env = process.env): ServiceClient {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Service-role Supabase credentials are not configured");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function pickDeliveryProvider(env = process.env): AlertDeliveryProvider {
  if (env.RESEND_API_KEY && env.ALERT_FROM_EMAIL) {
    return new ResendDeliveryProvider(env.RESEND_API_KEY, env.ALERT_FROM_EMAIL);
  }
  return new NoopDeliveryProvider();
}

/** Structured log line. Never carries secrets, tokens, or full user records. */
function logEvent(stage: string, fields: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(`[alert-sweep] ${stage} ${JSON.stringify(fields)}`);
}

export async function runAlertSweep(options?: {
  client?: ServiceClient;
  delivery?: AlertDeliveryProvider;
  now?: Date;
  baseUrl?: string;
}): Promise<SweepSummary> {
  const started = Date.now();
  const runId = `sweep_${started.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = options?.now ?? new Date();
  const client = options?.client ?? createServiceClient();
  const delivery = options?.delivery ?? pickDeliveryProvider();
  const baseUrl =
    options?.baseUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://archivescout.vercel.app";

  const summary: SweepSummary = {
    runId,
    searchesProcessed: 0,
    searchesSkipped: 0,
    listingsCompared: 0,
    newListings: 0,
    priceDrops: 0,
    eventsCreated: 0,
    duplicatesSuppressed: 0,
    emailsSent: 0,
    marketplaceFailures: [],
    errors: [],
    durationMs: 0,
  };

  // ── claim a batch: enabled, not currently leased, least recently checked ──
  const leaseUntil = new Date(now.getTime() + LEASE_MINUTES * 60_000).toISOString();
  const { data: candidates, error: loadErr } = await client
    .from("saved_searches")
    .select("*")
    .eq("is_notification_enabled", true)
    .or(`alert_lease_until.is.null,alert_lease_until.lt.${now.toISOString()}`)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(MAX_SEARCHES_PER_RUN);

  if (loadErr) {
    summary.errors.push(`load: ${loadErr.message}`);
    summary.durationMs = Date.now() - started;
    return summary;
  }

  logEvent("start", { runId, candidates: candidates?.length ?? 0 });

  for (const search of candidates ?? []) {
    // Take the lease. The WHERE clause re-checks the lease, so if another
    // worker claimed this row between our SELECT and now, we get 0 rows and
    // skip — this is the concurrency guard, in the database, not in memory.
    const { data: leased } = await client
      .from("saved_searches")
      .update({ alert_lease_until: leaseUntil, alert_lease_owner: runId })
      .eq("id", search.id)
      .or(`alert_lease_until.is.null,alert_lease_until.lt.${now.toISOString()}`)
      .select("id");

    if (!leased || leased.length === 0) {
      summary.searchesSkipped += 1;
      continue;
    }

    try {
      const payload: SavedSearchPayload = {
        query: search.query,
        marketplaces: search.marketplaces,
        filters: (search.filters ?? {}) as SavedSearchPayload["filters"],
        sort: search.sort,
      };

      // Replay through the real engine — bounded to MAX_PAGES_PER_SEARCH.
      const params = fromSavedSearchPayload(payload);
      const result = await runSearch({ ...params, page: MAX_PAGES_PER_SEARCH });

      for (const status of result.marketplaceStatus) {
        if (!status.ok) {
          const label = `${status.marketplace}:${status.error ?? "failed"}`;
          if (!summary.marketplaceFailures.includes(label)) {
            summary.marketplaceFailures.push(label);
          }
        }
      }

      const seen: SeenListing[] = result.listings.map((l) => ({
        marketplace: l.marketplace,
        externalId: l.externalId,
        price: l.price,
        currency: l.currency || "USD",
      }));
      summary.listingsCompared += seen.length;

      const { data: snapshots } = await client
        .from("saved_search_listing_snapshots")
        .select("marketplace, external_listing_id, last_price, currency, last_notified_price")
        .eq("saved_search_id", search.id);

      const { events, baseline } = detectEvents(
        search.id,
        seen,
        snapshots ?? [],
        search.notification_types ?? [],
      );

      // Insert events first: if the job dies mid-way, the dedupe key means the
      // retry suppresses rather than duplicates.
      const created: DetectedEvent[] = [];
      for (const ev of events) {
        const { error } = await client.from("saved_search_alert_events").insert({
          saved_search_id: search.id,
          user_id: search.user_id,
          event_type: ev.type,
          marketplace: ev.marketplace,
          external_listing_id: ev.externalId,
          previous_price: ev.previousPrice,
          current_price: ev.currentPrice,
          currency: ev.currency,
          listing_snapshot: (result.listings.find(
            (l) => l.externalId === ev.externalId && l.marketplace === ev.marketplace,
          ) ?? {}) as never,
          dedupe_key: ev.dedupeKey,
        } as never);

        if (error) {
          if (error.code === "23505") {
            summary.duplicatesSuppressed += 1; // already alerted — correct
            continue;
          }
          summary.errors.push(`event ${ev.dedupeKey}: ${error.message}`);
          continue;
        }
        created.push(ev);
        if (ev.type === "new_listing") summary.newListings += 1;
        else summary.priceDrops += 1;
      }
      summary.eventsCreated += created.length;

      // Upsert snapshots. `last_notified_price` only advances for listings we
      // actually alerted on, which is what silences a standing price.
      const notified = new Map(
        created.filter((e) => e.type === "price_drop").map((e) => [
          `${e.marketplace}:${e.externalId}`,
          e.currentPrice,
        ]),
      );
      const priorNotified = new Map(
        (snapshots ?? []).map((s) => [
          `${s.marketplace}:${s.external_listing_id}`,
          s.last_notified_price,
        ]),
      );

      if (seen.length > 0) {
        const rows = result.listings.map((l) => {
          const k = `${l.marketplace}:${l.externalId}`;
          return {
            saved_search_id: search.id,
            marketplace: l.marketplace,
            external_listing_id: l.externalId,
            last_price: l.price,
            currency: l.currency || "USD",
            last_seen_at: now.toISOString(),
            is_active: true,
            listing_snapshot: l as never,
            // Baseline: record the price as "already notified" so the first
            // real sweep can't fire a drop against a price nobody saw.
            last_notified_price: baseline
              ? l.price
              : (notified.get(k) ?? priorNotified.get(k) ?? null),
          };
        });
        const { error: upErr } = await client
          .from("saved_search_listing_snapshots")
          .upsert(rows as never, {
            onConflict: "saved_search_id,marketplace,external_listing_id",
          });
        if (upErr) summary.errors.push(`snapshot: ${upErr.message}`);
      }

      await client
        .from("saved_searches")
        .update({
          last_checked_at: now.toISOString(),
          alert_lease_until: null,
          alert_lease_owner: null,
        })
        .eq("id", search.id);

      summary.searchesProcessed += 1;
      logEvent("search", {
        runId,
        searchId: search.id,
        baseline,
        compared: seen.length,
        events: created.length,
      });
    } catch (err) {
      summary.errors.push(
        `search ${search.id}: ${err instanceof Error ? err.message : "unknown"}`,
      );
      // Always release the lease so a failure doesn't wedge the search for
      // LEASE_MINUTES on every subsequent run.
      await client
        .from("saved_searches")
        .update({ alert_lease_until: null, alert_lease_owner: null })
        .eq("id", search.id);
    }
  }

  // ── digest: one email per user, covering everything pending ──
  summary.emailsSent = await deliverDigests(client, delivery, baseUrl, summary);

  summary.durationMs = Date.now() - started;
  logEvent("done", { ...summary, errors: summary.errors.length });
  return summary;
}

/** Group pending events per user and send one digest each. */
async function deliverDigests(
  client: ServiceClient,
  delivery: AlertDeliveryProvider,
  baseUrl: string,
  summary: SweepSummary,
): Promise<number> {
  const { data: pending, error } = await client
    .from("saved_search_alert_events")
    .select("*")
    .eq("delivery_status", "pending")
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    summary.errors.push(`digest load: ${error.message}`);
    return 0;
  }
  if (!pending || pending.length === 0) return 0; // never send an empty email

  const byUser = new Map<string, typeof pending>();
  for (const ev of pending) {
    const list = byUser.get(ev.user_id) ?? [];
    list.push(ev);
    byUser.set(ev.user_id, list);
  }

  let sent = 0;
  for (const [userId, events] of byUser) {
    const searchIds = [...new Set(events.map((e) => e.saved_search_id))];
    const { data: searches } = await client
      .from("saved_searches")
      .select("*")
      .in("id", searchIds);
    const searchById = new Map((searches ?? []).map((s) => [s.id, s]));

    // Address comes from auth.users via the service role — never from a
    // client-supplied value.
    const { data: userRes } = await client.auth.admin.getUserById(userId);
    const email = userRes?.user?.email;
    if (!email) {
      summary.errors.push(`digest: no email for user`);
      continue;
    }

    const sections = searchIds
      .map((sid) => {
        const s = searchById.get(sid);
        if (!s) return null;
        const payload: SavedSearchPayload = {
          query: s.query,
          marketplaces: s.marketplaces,
          filters: (s.filters ?? {}) as SavedSearchPayload["filters"],
          sort: s.sort,
        };
        const listings: AlertEmailListing[] = events
          .filter((e) => e.saved_search_id === sid)
          .map((e) => {
            const snap = (e.listing_snapshot ?? {}) as Record<string, unknown>;
            return {
              title: String(snap.title ?? "Listing"),
              marketplace: e.marketplace,
              imageUrl: Array.isArray(snap.imageUrls)
                ? (snap.imageUrls[0] as string | undefined)
                : undefined,
              listingUrl: String(snap.listingUrl ?? baseUrl),
              currency: e.currency,
              price: Number(e.current_price ?? 0),
              previousPrice: e.previous_price == null ? undefined : Number(e.previous_price),
              eventType: e.event_type as AlertEmailListing["eventType"],
            };
          });
        return {
          savedSearchName: s.name || s.query || "Saved search",
          searchUrl: `${baseUrl}${toSearchUrl(payload)}`,
          listings,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null && s.listings.length > 0);

    if (sections.length === 0) continue;

    const digest: SavedSearchAlertEmail = {
      to: email,
      sections,
      newCount: events.filter((e) => e.event_type === "new_listing").length,
      dropCount: events.filter((e) => e.event_type === "price_drop").length,
    };

    const ids = events.map((e) => e.id);
    try {
      await delivery.sendSavedSearchAlert(digest);
      await client
        .from("saved_search_alert_events")
        .update({ delivery_status: "sent", delivered_at: new Date().toISOString() })
        .in("id", ids);
      sent += 1;
    } catch (err) {
      // Left 'pending' on purpose: the next sweep retries, and the dedupe key
      // still prevents duplicate EVENTS even if an email is retried.
      summary.errors.push(
        `delivery: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }
  return sent;
}

/** Readiness gate used by the cron route. */
export function sweepIsConfigured(): boolean {
  return alertsReadiness().enabled;
}
