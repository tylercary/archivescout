"use client";

import Link from "next/link";
import { AlertTriangle, RotateCw, SearchX } from "lucide-react";
import type { MarketplaceStatus } from "@/lib/marketplaces/types";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { TRENDING_SEARCHES } from "@/lib/constants";

/** Skeleton grid shown while results load. */
export function SkeletonGrid({ count = 8, view = "grid" }: { count?: number; view?: "grid" | "list" }) {
  if (view === "list") {
    return (
      <div className="flex flex-col gap-3" aria-hidden>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex gap-4 rounded-lg border border-border p-4">
            <Skeleton className="aspect-[4/5] w-24 sm:w-32" />
            <div className="flex-1 space-y-3 py-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="mt-6 h-5 w-28" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4"
      aria-hidden
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="aspect-[4/5] w-full rounded-lg" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </div>
  );
}

/** Per-marketplace failure + not-connected notices. */
export function MarketplaceNotices({
  statuses,
}: {
  statuses: MarketplaceStatus[];
}) {
  const failed = statuses.filter((s) => !s.ok);
  const notConnected = statuses.filter((s) => s.notConnected);
  const searched = statuses.filter((s) => s.ok && !s.notConnected);
  const unsupported = statuses.filter((s) => s.unsupportedFilters?.length);
  if (failed.length === 0 && notConnected.length === 0 && unsupported.length === 0)
    return null;

  const filterNoun = (key: string) =>
    key === "sizes" ? "size" : key === "colors" ? "color" : key;

  return (
    <div className="mb-6 space-y-2">
      {/* Honest filtering: a marketplace that cannot apply an active filter
          sits the search out VISIBLY instead of silently vanishing. */}
      {unsupported.map((s) => (
        <div
          key={`${s.marketplace}-unsupported`}
          role="status"
          className="flex items-start gap-2.5 rounded-md border border-border bg-secondary/60 px-3.5 py-2.5 text-sm text-muted-foreground"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 opacity-60" />
          <span>
            {s.unsupportedFilters!.includes("trust")
              ? `${MARKETPLACE_LABELS[s.marketplace]} does not currently expose authentication information for this trust filter.`
              : `${MARKETPLACE_LABELS[s.marketplace]} could not be filtered by ${s
                  .unsupportedFilters!.map((f) => `this ${filterNoun(f)}`)
                  .join(" or ")} for the current category — showing results from ${
                  searched
                    .filter((x) => x.marketplace !== s.marketplace && x.count > 0)
                    .map((x) => MARKETPLACE_LABELS[x.marketplace])
                    .join(", ") || "other marketplaces"
                }.`}
          </span>
        </div>
      ))}
      {notConnected.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-md border border-border bg-secondary/60 px-3.5 py-2.5 text-sm text-muted-foreground"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 opacity-60" />
          <span>
            {notConnected.map((s) => MARKETPLACE_LABELS[s.marketplace]).join(" and ")}{" "}
            {notConnected.length === 1 ? "isn't" : "aren't"} connected yet —
            results are from{" "}
            {searched.map((s) => MARKETPLACE_LABELS[s.marketplace]).join(", ") ||
              "no connected marketplaces"}
            .
          </span>
        </div>
      )}
      {failed.map((s) => (
        <div
          key={s.marketplace}
          role="status"
          className="flex items-start gap-2.5 rounded-md border border-amber-300/60 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong className="font-semibold">
              {MARKETPLACE_LABELS[s.marketplace]}
            </strong>{" "}
            couldn&apos;t be searched right now
            {s.error ? ` (${s.error})` : ""}. Showing results from the other
            marketplaces.
          </span>
        </div>
      ))}
    </div>
  );
}

/** Polished empty-results state with broader-search suggestions. */
export function EmptyResults({
  query,
  onClearFilters,
  hasFilters,
  trustFiltered = false,
}: {
  query: string;
  onClearFilters: () => void;
  hasFilters: boolean;
  /** A trust filter is active — say so instead of a generic empty page. */
  trustFiltered?: boolean;
}) {
  // "Browse similar" keeps the query but drops the refinements that most often
  // over-narrow a search, so the user lands somewhere useful rather than empty.
  const similarHref = query
    ? `/search?q=${encodeURIComponent(query.split(" ").slice(0, 2).join(" "))}`
    : "/search";

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/30 px-6 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-card shadow-sm">
        <SearchX className="h-7 w-7 text-muted-foreground" />
      </div>
      <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight">
        {trustFiltered
          ? "No authenticated listings matched your filters."
          : "No listings matched your search."}
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {query ? (
          <>
            Nothing came back for{" "}
            <span className="font-medium text-foreground">“{query}”</span>
            {hasFilters ? " with your current filters" : ""}. Try removing a
            filter or widening your search.
          </>
        ) : (
          "Try searching for a brand, item, or style to get started."
        )}
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {hasFilters && (
          <Button variant="outline" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
        <Button asChild variant={hasFilters ? "default" : "outline"}>
          <Link href={similarHref}>Browse similar listings</Link>
        </Button>
      </div>

      <div className="mt-10 w-full max-w-lg">
        <p className="eyebrow mb-3">Popular right now</p>
        <div className="flex flex-wrap justify-center gap-2">
          {TRENDING_SEARCHES.map((t) => (
            <Link
              key={t.query}
              href={`/search?q=${encodeURIComponent(t.query)}`}
              className="rounded-full border border-border bg-card px-3.5 py-2 text-sm transition-colors hover:border-foreground/30 hover:bg-accent"
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Full-page error state with retry. */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-card shadow-sm">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>
      <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight">
        Something went wrong
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{message}</p>
      <Button className="mt-6" onClick={onRetry}>
        <RotateCw className="h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}
