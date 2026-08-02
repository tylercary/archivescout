"use client";

import * as React from "react";
import { Bookmark, Check } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { alertsEnabledPublic } from "@/lib/saved-searches/alerts-config";
import {
  describeSearch,
  defaultSearchName,
  type SavedSearchPayload,
} from "@/lib/saved-searches/serializer";
import type { NotificationType } from "@/lib/saved-searches/notification-scheduler";
import type { SavedSearchRecord } from "@/lib/saved-searches/service";
import { useSavedSearches } from "@/lib/saved-searches/use-saved-searches";

/**
 * Save / edit a saved search.
 *
 * Shows a readable summary built by `describeSearch` — user-facing labels
 * only, never raw filter keys or marketplace syntax. Notification choices are
 * stored; nothing is delivered yet (see notification-scheduler.ts).
 */
export function SaveSearchDialog({
  open,
  onClose,
  payload,
  searchQueryString,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  payload: SavedSearchPayload;
  searchQueryString: string;
  /** When set, the dialog edits this saved search instead of creating one. */
  existing?: SavedSearchRecord | null;
}) {
  // Honest UI: never imply an alert will be delivered when nothing delivers it.
  const alertsLive = alertsEnabledPublic();
  const { save, update } = useSavedSearches();
  const [name, setName] = React.useState("");
  const [types, setTypes] = React.useState<NotificationType[]>([]);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Re-seed whenever the dialog opens or the target changes.
  React.useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? defaultSearchName(payload));
    setTypes(existing?.notificationTypes ?? []);
    setError(null);
  }, [open, existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleType = (t: NotificationType) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (existing) {
        await update(existing.id, { name: name.trim(), notificationTypes: types });
      } else {
        await save({ searchQueryString, name: name.trim(), notificationTypes: types });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  };

  const rows = describeSearch(payload);

  return (
    <Dialog open={open} onClose={onClose} label={existing ? "Edit saved search" : "Save search"}>
      <form onSubmit={submit} className="flex max-h-[85vh] flex-col overflow-y-auto p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <Bookmark className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="font-display text-xl font-semibold tracking-tight">
            {existing ? "Edit saved search" : "Save this search"}
          </h2>
        </div>

        <label htmlFor="saved-search-name" className="mt-5 block text-sm font-medium">
          Name
        </label>
        <input
          id="saved-search-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          autoFocus
          className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <h3 className="eyebrow mt-6">What you&apos;re saving</h3>
        <dl className="mt-2 divide-y divide-border rounded-md border border-border">
          {rows.map((r) => (
            <div key={r.label} className="flex gap-4 px-3.5 py-2 text-sm">
              <dt className="w-32 shrink-0 text-muted-foreground">{r.label}</dt>
              <dd className="min-w-0 flex-1 text-foreground">{r.value}</dd>
            </div>
          ))}
        </dl>

        <h3 className="eyebrow mt-6">
          Notify me about
          {!alertsLive && (
            <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[0.65rem] font-medium normal-case tracking-normal text-muted-foreground">
              Coming soon
            </span>
          )}
        </h3>
        <div className="mt-2 space-y-2.5">
          <Checkbox
            checked={types.includes("new_listings")}
            onCheckedChange={() => toggleType("new_listings")}
            label="New listings"
            disabled={!alertsLive}
          />
          <Checkbox
            checked={types.includes("price_drops")}
            onCheckedChange={() => toggleType("price_drops")}
            label="Price drops"
            disabled={!alertsLive}
          />
          <p className="text-xs text-muted-foreground">
            {alertsLive
              ? "We'll email you when this search finds something."
              : "Alerts aren't running yet — these will switch on automatically once they are. Nothing is sent today."}
          </p>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-2">
          <Button type="submit" className="flex-1" disabled={pending || !name.trim()}>
            {pending ? "Saving…" : existing ? "Save changes" : "Save search"}
            {!pending && <Check className="h-4 w-4" />}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
