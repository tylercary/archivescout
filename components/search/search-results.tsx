"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  MARKETPLACE_LABELS,
  type EnrichedListing,
  type SearchResponse,
} from "@/lib/marketplaces/types";
import { parseSearchParams, countActiveFilters } from "@/lib/search/params";
import { fetchSearch } from "@/lib/search/client";
import { useSearches } from "@/lib/store/searches";
import { useLocalStorage } from "@/lib/store/use-local-storage";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ListingGrid } from "@/components/listings/listing-grid";
import { FilterPanel } from "@/components/filters/filter-panel";
import { ActiveFilterChips } from "@/components/filters/active-filter-chips";
import { RecentSearches } from "./recent-searches";
import { ResultsToolbar } from "./results-toolbar";
import {
  EmptyResults,
  ErrorState,
  MarketplaceNotices,
  SkeletonGrid,
} from "./search-states";
import { useFilterUpdater } from "@/components/filters/use-filter-updater";

type Status = "loading" | "loadingMore" | "success" | "error";

export function SearchResults() {
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();

  const params = React.useMemo(
    () => parseSearchParams(new URLSearchParams(paramsKey)),
    [paramsKey],
  );

  const { addRecent } = useSearches();
  const { clearFilters, setSort } = useFilterUpdater();

  const [listings, setListings] = React.useState<EnrichedListing[]>([]);
  const [meta, setMeta] = React.useState<SearchResponse | null>(null);
  const [status, setStatus] = React.useState<Status>("loading");
  const [error, setError] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [view, setView] = useLocalStorage<"grid" | "list">("archivescout:view", "grid");
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);

  const activeFilterCount = countActiveFilters(params.filters);

  // Record the query as a recent search.
  React.useEffect(() => {
    if (params.query) addRecent(params.query, params.marketplaces);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.query]);

  // One AbortController per search identity (query + filters + sort). Any
  // filter/query change aborts BOTH the in-flight base fetch and any pending
  // "Load more", so stale (e.g. size-32) results can never land after the
  // filters have changed (e.g. to size-34).
  const controllerRef = React.useRef<AbortController | null>(null);

  // Fetch base page whenever the search parameters change: reset to page 1,
  // clear stale results via loading state, replace with filtered page one.
  // Skip the scroll-reset on the very first mount (deep links may legitimately
  // restore a position); only reset when the user changes the search in-page.
  const mountedRef = React.useRef(false);

  React.useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("loading");
    setPage(1);
    setExhausted(false);
    countRef.current = 0;
    inFlightRef.current = false;

    // A filter/query/sort change resets to page 1, so the list shrinks from
    // however many pages were auto-loaded down to 24. If the user was scrolled
    // deep, the browser would clamp their position to the new (short) bottom —
    // which reads as "the page jumped to the bottom" and immediately kicks off
    // an auto-load cascade. Bring them back to the top of the fresh results.
    if (mountedRef.current) {
      window.scrollTo({ top: 0 });
    }
    mountedRef.current = true;
    fetchSearch({ ...params, page: 1 }, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        countRef.current = res.listings.length;
        setListings(res.listings);
        setMeta(res);
        setStatus("success");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Drop the previous search's results. They belong to DIFFERENT search
        // params, so keeping them renders unfiltered listings underneath the
        // new filter chips — silently presenting stale data as filtered
        // results (e.g. all 87 "erl vamp" listings under a "Size 13" chip).
        // Clearing them lets the error state show instead of a quiet lie.
        setListings([]);
        setMeta(null);
        countRef.current = 0;
        setError(err instanceof Error ? err.message : "Search failed");
        setStatus("error");
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, reloadToken]);

  // Guards for auto-loading: `inFlightRef` prevents overlapping requests (the
  // observer can fire repeatedly), `countRef` tracks how many listings we have
  // so we can detect a page that adds nothing.
  const inFlightRef = React.useRef(false);
  const countRef = React.useRef(0);
  const [exhausted, setExhausted] = React.useState(false);

  // The search identity that owns the currently-rendered results. A stale
  // auto-load closure (the scroll/IO/poll triggers can fire in the gap between
  // a filter click and React tearing their effect down) would otherwise write
  // an UNFILTERED deeper page over freshly filtered results.
  const activeKeyRef = React.useRef(paramsKey);
  activeKeyRef.current = paramsKey;

  const loadMore = React.useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const next = page + 1;
    const controller = controllerRef.current;
    const requestKey = paramsKey;
    // Bail if this closure belongs to a superseded search.
    if (requestKey !== activeKeyRef.current) {
      inFlightRef.current = false;
      return;
    }
    setStatus("loadingMore");
    // Same full search identity (query + every active filter + sort), next
    // page — never an unfiltered page.
    fetchSearch({ ...params, page: next }, controller?.signal)
      .then((res) => {
        if (controller?.signal.aborted) return;
        if (requestKey !== activeKeyRef.current) return; // superseded search
        // If a deeper page adds nothing, the source is effectively exhausted
        // (its `has_more` can be optimistic). Stop here so auto-loading can't
        // hammer a metered, rate-limited API in a loop.
        if (res.listings.length <= countRef.current) setExhausted(true);
        countRef.current = res.listings.length;
        // The API returns the CUMULATIVE result set for pages 1..N (already
        // globally sorted and unique by id), so render it directly — no
        // append/dedupe bookkeeping, no gaps, no repeats.
        setListings(res.listings);
        setMeta(res); // keep totals / hasMore / statuses current
        setPage(next);
        setStatus("success");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load more");
        setStatus("error");
        // Don't auto-retry a failure (e.g. a rate limit) — let the user click.
        setExhausted(true);
      })
      .finally(() => {
        inFlightRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, paramsKey]);

  const total = meta?.total ?? 0;
  const hasMore =
    status !== "loading" &&
    !exhausted &&
    (listings.length < total || Boolean(meta?.sourceHasMore));

  /* ─────────────────────── auto-load on scroll ───────────────────────
   * A sentinel below the grid triggers the next page 600px early, so loading
   * feels seamless. Two mechanisms, because either alone has a gap:
   *   1. IntersectionObserver — fires when the sentinel scrolls INTO view.
   *   2. A post-load re-check — after a page lands, the sentinel is often
   *      still in view, and IO won't re-fire without a new transition.
   * Refs keep the observer attached for the whole search instead of being torn
   * down on every state change (which was silently dropping triggers).
   */
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const canLoadMore = hasMore && status !== "loadingMore";

  React.useEffect(() => {
    if (!canLoadMore) return;
    const el = sentinelRef.current;
    if (!el) return;

    // Load when the sentinel is within one viewport + 600px, so the next page
    // arrives before the user hits the bottom. `loadMore` is captured fresh
    // (it's an effect dep), so this can never re-request the current page.
    const check = () => {
      if (el.getBoundingClientRect().top <= window.innerHeight + 600) loadMore();
    };

    // Three triggers, because each alone leaves a gap:
    //   scroll  — the normal case while browsing
    //   IO      — catches the sentinel entering view
    //   resize  — product images load after render and keep changing the page
    //             height, so the sentinel can settle into range with no scroll
    //             and no IO transition to notice
    let queued = false;
    const onEvent = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        check();
      });
    };

    const io = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting && check(),
      { rootMargin: "600px 0px" },
    );
    io.observe(el);

    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(onEvent) : null;
    ro?.observe(document.body);

    window.addEventListener("scroll", onEvent, { passive: true });
    window.addEventListener("resize", onEvent, { passive: true });

    // Guaranteed backstop: one cheap rect read every 500ms, and only while more
    // results exist (the effect tears down as soon as `canLoadMore` is false).
    // Event-based triggers alone proved leaky — images settling after render
    // can move the sentinel into range with no scroll, IO, or resize signal.
    const poll = window.setInterval(check, 500);
    const t = window.setTimeout(check, 250);

    return () => {
      io.disconnect();
      ro?.disconnect();
      window.removeEventListener("scroll", onEvent);
      window.removeEventListener("resize", onEvent);
      window.clearInterval(poll);
      window.clearTimeout(t);
    };
  }, [canLoadMore, loadMore]);
  const facets = meta?.facets;
  const isInitialLoading = status === "loading";

  // Marketplaces actually searched (excludes not-connected ones in live mode).
  const searchedMarketplaces = meta
    ? meta.marketplaceStatus.filter((s) => !s.notConnected).map((s) => s.marketplace)
    : params.marketplaces;

  /**
   * Result summary, in three honest forms:
   *   "Showing 48 of 327 listings" — the source reported a filtered total
   *   "48 listings loaded"         — more exists but no trustworthy total
   *   "327 Chanel sneakers"        — everything loaded; describe what they are
   */
  const resultSummary = React.useMemo(() => {
    const f = params.filters;
    const sourceTotal = meta?.sourceTotal;
    // Count what is actually ON SCREEN. `meta.total` is everything fetched and
    // filtered so far, which runs AHEAD of the rendered page — a source page is
    // fetched per department and merged, so a 24-item page can sit on 48 loaded
    // rows. Reporting that number said "Showing 48" above 24 visible cards.
    const shown = listings.length;
    const n = shown.toLocaleString();

    if (
      sourceTotal !== undefined &&
      meta?.sourceTotalReflectsFilters &&
      sourceTotal > shown
    ) {
      return (
        <>
          Showing <span className="font-medium text-foreground">{n}</span> of{" "}
          {sourceTotal.toLocaleString()} listings
        </>
      );
    }
    if (hasMore) {
      return (
        <>
          <span className="font-medium text-foreground">{n}</span>{" "}
          {shown === 1 ? "listing" : "listings"} loaded
        </>
      );
    }
    // Fully loaded — name the thing, e.g. "327 Chanel sneakers". Category nouns
    // are plural, so a single result falls back to "1 Chanel listing".
    const brand = f.brands?.length === 1 ? f.brands[0] : undefined;
    const category =
      shown !== 1 && f.categories?.length === 1
        ? f.categories[0].toLowerCase()
        : undefined;
    const noun = category ?? (shown === 1 ? "listing" : "listings");
    return (
      <>
        <span className="font-medium text-foreground">{n}</span>{" "}
        {[brand, noun].filter(Boolean).join(" ")}
      </>
    );
  }, [meta, listings.length, hasMore, params.filters]);

  return (
    <div className="container py-4 sm:py-5">
      {/* Header */}
      <header className="mb-4">
        <p className="eyebrow">Search results</p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          {params.query ? `“${params.query}”` : "All listings"}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span aria-live="polite">
            {isInitialLoading
              ? "Searching…"
              : status === "error"
                ? "Search failed"
                : resultSummary}
          </span>
          <span aria-hidden>·</span>
          <span>
            {searchedMarketplaces.map((m) => MARKETPLACE_LABELS[m]).join(", ") ||
              "No marketplaces connected"}
          </span>
          {meta && meta.tookMs > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{meta.tookMs}ms</span>
            </>
          )}
        </div>
      </header>

      {!params.query && <RecentSearches className="mb-6" />}

      {/* Toolbar */}
      <ResultsToolbar
        params={params}
        sort={params.sort}
        onSortChange={setSort}
        view={view}
        onViewChange={setView}
        activeFilterCount={activeFilterCount}
        onOpenFilters={() => setFiltersOpen(true)}
      />

      <div className="mt-6 flex gap-8">
        {/* Desktop filter sidebar */}
        {facets && (
          <aside className="hidden w-64 shrink-0 lg:block">
            <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8 pr-1">
              <FilterPanel facets={facets} activeCount={activeFilterCount} />
            </div>
          </aside>
        )}

        {/* Results */}
        <div className="min-w-0 flex-1">
          <ActiveFilterChips />
          {meta && <MarketplaceNotices statuses={meta.marketplaceStatus} />}

          {status === "error" && listings.length === 0 ? (
            <ErrorState message={error} onRetry={() => setReloadToken((t) => t + 1)} />
          ) : isInitialLoading ? (
            <SkeletonGrid view={view} count={8} />
          ) : listings.length === 0 ? (
            <EmptyResults
              query={params.query}
              hasFilters={activeFilterCount > 0}
              trustFiltered={Boolean(params.filters.trust?.length)}
              onClearFilters={clearFilters}
            />
          ) : (
            <>
              <ListingGrid
                listings={listings}
                view={view}
                sizeFilterActive={Boolean(params.filters.sizes?.length)}
              />

              {/* Auto-load trigger: crossing this (600px early) fetches the
                  next page. Zero-height so it never affects layout. */}
              <div ref={sentinelRef} aria-hidden className="h-px w-full" />

              {status === "loadingMore" && (
                <div className="mt-10" aria-live="polite" aria-busy="true">
                  <p className="mb-6 text-center text-sm text-muted-foreground">
                    Loading more listings…
                  </p>
                  <SkeletonGrid view={view} count={view === "grid" ? 4 : 2} />
                </div>
              )}

              {/* Kept for keyboard/screen-reader users and as the fallback when
                  auto-loading has stopped (error or nothing new returned). */}
              {hasMore && status !== "loadingMore" && (
                <div className="mt-10 flex justify-center">
                  <Button variant="outline" size="lg" onClick={loadMore}>
                    {meta?.sourceHasMore
                      ? "Load more"
                      : `Load more (${Math.max(0, total - listings.length)} more)`}
                  </Button>
                </div>
              )}

              {/* Terminal cue: with auto-loading, users need to know the feed
                  ended rather than wondering if it's still fetching. Only shown
                  once something was actually loaded beyond the first page. */}
              {!hasMore && status !== "loadingMore" && listings.length > 0 &&
                (page > 1 || exhausted) && (
                  <p className="mt-10 text-center text-sm text-muted-foreground">
                    You&apos;ve reached the end of these results.
                  </p>
                )}
            </>
          )}
        </div>
      </div>

      {/* Mobile filter drawer */}
      {facets && (
        <Sheet
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          side="left"
          label="Filters"
        >
          <div className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto p-5 pt-14">
              <FilterPanel facets={facets} activeCount={activeFilterCount} />
            </div>
            <div className="border-t border-border p-4">
              <Button className="w-full" size="lg" onClick={() => setFiltersOpen(false)}>
                Show {total} {total === 1 ? "result" : "results"}
              </Button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
