"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Bookmark, Play, Search, Trash2 } from "lucide-react";
import { useSearches } from "@/lib/store/searches";
import { MARKETPLACE_LABELS } from "@/lib/marketplaces/types";
import { toQueryString, countActiveFilters, DEFAULT_PER_PAGE } from "@/lib/search/params";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, cn } from "@/lib/utils";
import type { SavedSearch } from "@/types";

export function SavedSearchesDashboard() {
  const { saved, removeSaved, togglePriceAlert, hydrated } = useSearches();
  const router = useRouter();

  const rerun = (s: SavedSearch) => {
    const qs = toQueryString({
      query: s.query,
      marketplaces: s.marketplaces,
      filters: s.filters,
      sort: s.sort,
      page: 1,
      perPage: DEFAULT_PER_PAGE,
    });
    router.push(`/search?${qs}`);
  };

  if (!hydrated) {
    return (
      <div className="container py-10 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
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
          Re-run a search any time. Toggle a price alert to flag the hunts you
          care about most.
        </p>
      </header>

      {saved.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/30 px-6 py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-card shadow-sm">
            <Bookmark className="h-7 w-7 text-muted-foreground" />
          </div>
          <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight">
            No saved searches
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Run a search, then tap “Save search” to keep it here for quick
            access.
          </p>
          <Button asChild className="mt-6">
            <Link href="/search">
              <Search className="h-4 w-4" />
              Start searching
            </Link>
          </Button>
        </div>
      ) : (
        <ul className="space-y-4">
          {saved.map((s) => {
            const filterCount = countActiveFilters(s.filters);
            return (
              <li
                key={s.id}
                className="rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold tracking-tight text-foreground">
                      {s.query || "All listings"}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Chip>
                        {s.marketplaces.map((m) => MARKETPLACE_LABELS[m]).join(", ")}
                      </Chip>
                      {filterCount > 0 && (
                        <Chip>
                          {filterCount} filter{filterCount === 1 ? "" : "s"}
                        </Chip>
                      )}
                      {s.maxDesiredPrice !== undefined && (
                        <Chip>Max {formatCurrency(s.maxDesiredPrice)}</Chip>
                      )}
                      <span>
                        Saved{" "}
                        {new Date(s.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => togglePriceAlert(s.id)}
                      aria-pressed={s.priceAlert}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                        s.priceAlert
                          ? "border-foreground bg-foreground text-background"
                          : "border-input text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {s.priceAlert ? (
                        <Bell className="h-3.5 w-3.5" />
                      ) : (
                        <BellOff className="h-3.5 w-3.5" />
                      )}
                      {s.priceAlert ? "Alert on" : "Alert off"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
                  <Button size="sm" onClick={() => rerun(s)}>
                    <Play className="h-3.5 w-3.5" />
                    Re-run search
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeSaved(s.id)}
                    aria-label="Remove saved search"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {saved.some((s) => s.priceAlert) && (
        <p className="mt-6 text-xs text-muted-foreground">
          Price alerts are stored on your account. Email notifications aren&apos;t
          sent in this demo — see the integration docs for wiring them up.
        </p>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-secondary px-2.5 py-1 font-medium text-foreground">
      {children}
    </span>
  );
}
