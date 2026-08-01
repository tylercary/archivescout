"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { SearchBar } from "@/components/search/search-bar";
import { MARKETPLACES } from "@/lib/marketplaces/types";

/**
 * The app's primary search, mounted in the navbar.
 *
 * This is NOT a second search component — it only reads the URL and renders
 * the same <SearchBar> the homepage hero uses, so the two can never drift.
 * Its own state comes from the query string, which keeps it synchronized with
 * back/forward navigation and survives a refresh.
 *
 * Preserved into the next search: the marketplace scope (the selector writes
 * `markets` itself) and `sort`. Grid/list view lives in local storage, so it
 * persists without a query param. Everything else — category, size, brand,
 * condition, price, pagination — is dropped by SearchBar on submit, so a new
 * query never inherits incompatible filters.
 */
export function NavbarSearch({
  className,
  autoFocus = false,
  onSubmit,
}: {
  className?: string;
  autoFocus?: boolean;
  /** Fired on submit — the mobile row uses it to collapse itself. */
  onSubmit?: () => void;
}) {
  const searchParams = useSearchParams();

  const query = searchParams.get("q")?.trim() ?? "";
  const sort = searchParams.get("sort") ?? undefined;
  const markets = searchParams.get("markets")?.split(",").filter(Boolean) ?? [];
  // A single pinned marketplace selects it; anything else reads "All marketplaces".
  const scope =
    markets.length === 1 &&
    (MARKETPLACES as readonly string[]).includes(markets[0])
      ? markets[0]
      : "all";

  return (
    <SearchBar
      // Re-seed the input whenever the URL query changes (submit, back/forward,
      // refresh) — SearchBar owns the value while the user is typing.
      key={query}
      size="compact"
      defaultQuery={query}
      defaultScope={scope}
      preserve={{ sort }}
      onSubmit={onSubmit}
      placeholder="Search…"
      autoFocus={autoFocus}
      className={className}
    />
  );
}

/** Same footprint as the real bar, so the navbar doesn't shift while it loads. */
export function NavbarSearchFallback({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={
        "h-12 w-full rounded-full border border-border bg-card shadow-sm " +
        (className ?? "")
      }
    />
  );
}
