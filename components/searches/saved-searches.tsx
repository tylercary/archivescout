"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Bookmark, Pencil, Play, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog } from "@/components/ui/dialog";
import { useAuth } from "@/lib/supabase/auth-context";
import { useSavedSearches } from "@/lib/saved-searches/use-saved-searches";
import { SaveSearchDialog } from "./save-search-dialog";
import {
  describeSearch,
  toSearchUrl,
  type SavedSearchPayload,
} from "@/lib/saved-searches/serializer";
import type { SavedSearchRecord } from "@/lib/saved-searches/service";
import { alertsEnabledPublic } from "@/lib/saved-searches/alerts-config";

const payloadOf = (s: SavedSearchRecord): SavedSearchPayload => ({
  query: s.query,
  marketplaces: s.marketplaces,
  filters: s.filters,
  sort: s.sort,
});

const dateLabel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

export function SavedSearchesDashboard() {
  const alertsLive = alertsEnabledPublic();
  const router = useRouter();
  const { user, loading: authLoading, configured } = useAuth();
  const { searches, loading, remove } = useSavedSearches();
  const [editing, setEditing] = React.useState<SavedSearchRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<SavedSearchRecord | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  if (!configured) {
    return (
      <Empty
        title="Saved searches need an account"
        body="Accounts aren't configured in this deployment yet."
      />
    );
  }

  if (authLoading) {
    return (
      <div className="container space-y-4 py-10">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <Empty
        title="Sign in to see your saved searches"
        body="Saved searches sync to your account, so they follow you across devices."
        action={
          <Button asChild>
            <Link href="/signin?next=/searches">
              <User className="h-4 w-4" />
              Sign in
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="container py-8 sm:py-10">
      <header className="mb-8">
        <p className="eyebrow">Your hunts</p>
        <h1 className="mt-1.5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Saved searches
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {loading
            ? "Loading…"
            : `${searches.length} saved ${searches.length === 1 ? "search" : "searches"}`}
        </p>
      </header>

      {loading && searches.length === 0 ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : searches.length === 0 ? (
        <Empty
          title="No saved searches yet"
          body="Run a search, refine it, then hit Save search to keep it here."
          action={
            <Button asChild>
              <Link href="/search">Start searching</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {searches.map((s) => {
            const rows = describeSearch(payloadOf(s)).filter(
              (r) => !["Query", "Sort"].includes(r.label),
            );
            return (
              <li key={s.id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-medium text-foreground">{s.name}</h2>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {s.query || "All listings"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" onClick={() => router.push(toSearchUrl(payloadOf(s)))}>
                      <Play className="h-3.5 w-3.5" />
                      Run search
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(s)}
                      aria-label={`Edit ${s.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDelete(s)}
                      aria-label={`Delete ${s.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {rows.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {rows.map((r) => (
                      <span
                        key={r.label}
                        className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
                      >
                        <span className="text-foreground/70">{r.label}:</span> {r.value}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Bell className="h-3 w-3" aria-hidden />
                    {s.notificationsEnabled
                      ? `${s.notificationTypes
                          .map((t) => (t === "new_listings" ? "New listings" : "Price drops"))
                          .join(", ")}${alertsLive ? "" : " · not sending yet"}`
                      : "Alerts off"}
                  </span>
                  <span>Saved {dateLabel(s.createdAt)}</span>
                  {s.lastCheckedAt && <span>Last checked {dateLabel(s.lastCheckedAt)}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <SaveSearchDialog
          open
          onClose={() => setEditing(null)}
          payload={payloadOf(editing)}
          searchQueryString=""
          existing={editing}
        />
      )}

      <Dialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        label="Delete saved search"
      >
        <div className="p-5 sm:p-6">
          <h2 className="font-display text-xl font-semibold tracking-tight">
            Delete saved search?
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{confirmDelete?.name}</span> will be
            removed. This can&apos;t be undone.
          </p>
          <div className="mt-6 flex gap-2">
            <Button
              className="flex-1"
              disabled={deleting}
              onClick={async () => {
                if (!confirmDelete) return;
                setDeleting(true);
                await remove(confirmDelete.id);
                setDeleting(false);
                setConfirmDelete(null);
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={deleting}>
              Cancel
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="container py-10">
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/30 px-6 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-card shadow-sm">
          <Bookmark className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="mt-6 font-display text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{body}</p>
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  );
}