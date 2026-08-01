"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MARKETPLACES } from "@/lib/marketplaces/types";

/** Query keys owned by filters (everything except q / markets / sort). */
const FILTER_KEYS = [
  "auth",
  "minPrice",
  "maxPrice",
  "sizes",
  "brands",
  "categories",
  "conditions",
  "colors",
  "genders",
  "locations",
  "freeShipping",
  "verifiedSeller",
  "newlyListed",
] as const;

/**
 * Hook that reads the current URL and returns helpers for mutating query
 * params. The URL is the single source of truth for search state, so every
 * filter change is instantly shareable and back/forward works.
 */
export function useFilterUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = React.useMemo(
    () => new URLSearchParams(searchParams.toString()),
    [searchParams],
  );

  const push = React.useCallback(
    (next: URLSearchParams) => {
      // Any filter/sort change resets pagination.
      next.delete("page");
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const getCsv = React.useCallback(
    (key: string): string[] => {
      const raw = current.get(key);
      return raw ? raw.split(",").filter(Boolean) : [];
    },
    [current],
  );

  const setScalar = React.useCallback(
    (key: string, value: string | undefined) => {
      const next = new URLSearchParams(current.toString());
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
      push(next);
    },
    [current, push],
  );

  const toggleInCsv = React.useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(current.toString());
      const set = new Set(getCsv(key));
      if (set.has(value)) set.delete(value);
      else set.add(value);
      if (set.size) next.set(key, [...set].join(","));
      else next.delete(key);
      push(next);
    },
    [current, getCsv, push],
  );

  const toggleBool = React.useCallback(
    (key: string) => {
      const next = new URLSearchParams(current.toString());
      if (next.get(key)) next.delete(key);
      else next.set(key, "1");
      push(next);
    },
    [current, push],
  );

  /** Marketplace filter maps to the `markets` param; all selected → omit it. */
  const toggleMarketplace = React.useCallback(
    (marketplace: string) => {
      const next = new URLSearchParams(current.toString());
      const selected = new Set(
        current.get("markets")?.split(",").filter(Boolean) ?? [...MARKETPLACES],
      );
      if (selected.has(marketplace)) selected.delete(marketplace);
      else selected.add(marketplace);
      // Never allow zero marketplaces.
      if (selected.size === 0) return;
      if (selected.size === MARKETPLACES.length) next.delete("markets");
      else next.set("markets", [...selected].join(","));
      push(next);
    },
    [current, push],
  );

  const setSort = React.useCallback(
    (value: string) => setScalar("sort", value === "recommended" ? undefined : value),
    [setScalar],
  );

  const clearFilters = React.useCallback(() => {
    const next = new URLSearchParams(current.toString());
    for (const key of FILTER_KEYS) next.delete(key);
    push(next);
  }, [current, push]);

  const clearAll = React.useCallback(() => {
    const next = new URLSearchParams();
    const q = current.get("q");
    if (q) next.set("q", q);
    push(next);
  }, [current, push]);

  return {
    current,
    getCsv,
    setScalar,
    toggleInCsv,
    toggleBool,
    toggleMarketplace,
    setSort,
    clearFilters,
    clearAll,
  };
}
