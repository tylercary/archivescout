/**
 * Notification scheduling seam.
 *
 * NOTHING is delivered today — this is the single interface a future cron job
 * plugs into, so adding alerts later touches only this file plus the job.
 *
 * ── How the future sweep will work ──────────────────────────────────────────
 * 1. Load notification-enabled searches, least-recently-checked first:
 *      select * from saved_searches
 *       where is_notification_enabled = true
 *       order by last_checked_at nulls first
 *      (the `saved_searches_alert_sweep_idx` partial index serves exactly this)
 * 2. Rebuild live search params with `fromSavedSearchPayload(row)` and run them
 *    through the SAME `runSearch` engine the UI uses — no duplicated logic, so
 *    alerts inherit every filter fix automatically.
 * 3. Compare against the previous result set. Two signals are needed:
 *      · new listings  → ids absent from the prior snapshot
 *      · price drops   → same id, lower `price` than the prior snapshot
 *    This requires persisting a per-search snapshot (id → price). Suggested:
 *    a `saved_search_snapshots` table (search_id, listing_id, price, seen_at)
 *    with RLS mirroring `saved_searches`, written by the job under the service
 *    role. Deliberately NOT created yet — it should be designed against real
 *    alert requirements rather than guessed at now.
 * 4. Filter to the user's chosen `notification_types`.
 * 5. Deliver (email/push) — the only genuinely new subsystem.
 * 6. Set `last_checked_at = now()` whether or not anything was found, so the
 *    sweep order stays fair.
 *
 * Idempotency note for whoever builds it: the job must tolerate re-runs
 * (a crashed sweep re-processing a search must not double-notify), so record
 * delivery per (search_id, listing_id, signal) before sending.
 */

export interface NotificationScheduler {
  /** Called when a user enables alerts on a saved search. */
  scheduleSavedSearch(searchId: string): Promise<void>;
  /** Called when alerts are disabled, or the search is deleted. */
  unscheduleSavedSearch(searchId: string): Promise<void>;
}

/**
 * The current implementation: a deliberate no-op.
 *
 * Scheduling is DATA, not a side effect — `is_notification_enabled` and
 * `notification_types` on the row are the source of truth, and the future
 * sweep reads them directly. So enabling alerts already "schedules" the
 * search; this interface exists so a push-based scheduler (queue, Inngest,
 * Supabase cron) can be dropped in without touching callers.
 */
export const noopNotificationScheduler: NotificationScheduler = {
  async scheduleSavedSearch(searchId: string) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(`[notifications] would schedule saved search ${searchId}`);
    }
  },
  async unscheduleSavedSearch(searchId: string) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(`[notifications] would unschedule saved search ${searchId}`);
    }
  },
};

/** Alert kinds a saved search can opt into (matches `notification_types`). */
export const NOTIFICATION_TYPES = ["new_listings", "price_drops"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
