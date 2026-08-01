"use client";

import Link from "next/link";
import { Clock, X } from "lucide-react";
import { useSearches } from "@/lib/store/searches";

/** Recently-run searches, restored from local storage. */
export function RecentSearches({ className }: { className?: string }) {
  const { recent, clearRecent, hydrated } = useSearches();
  if (!hydrated || recent.length === 0) return null;

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Recent searches
        </span>
        <button
          onClick={clearRecent}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Clear
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {recent.map((r) => {
          const params = new URLSearchParams({ q: r.query });
          if (r.marketplaces.length === 1) params.set("markets", r.marketplaces[0]);
          return (
            <Link
              key={r.query}
              href={`/search?${params.toString()}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:border-foreground/30"
            >
              {r.query}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
