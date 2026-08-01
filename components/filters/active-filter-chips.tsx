"use client";

import * as React from "react";
import { X } from "lucide-react";
import {
  MARKETPLACES,
  MARKETPLACE_LABELS,
  type Marketplace,
} from "@/lib/marketplaces/types";
import { formatCurrency } from "@/lib/utils";
import { useFilterUpdater } from "./use-filter-updater";
import { sizeTokenValue } from "@/lib/search/normalized-filters";

interface Chip {
  key: string;
  label: string;
  remove: () => void;
}

/**
 * Removable summary of every active filter, shown directly above the grid so
 * users can see and undo their refinements without hunting the sidebar.
 */
export function ActiveFilterChips() {
  const u = useFilterUpdater();
  const chips: Chip[] = [];

  const csvChips = (
    key: string,
    render: (v: string) => string = (v) => v,
  ) => {
    for (const value of u.getCsv(key)) {
      chips.push({
        key: `${key}:${value}`,
        label: render(value),
        remove: () => u.toggleInCsv(key, value),
      });
    }
  };

  const TRUST_LABELS: Record<string, string> = {
    authenticated: "Authenticated",
    guarantee: "Authenticity Guarantee",
    trusted: "Trusted Seller",
  };
  csvChips("trust", (v) => TRUST_LABELS[v] ?? v);
  csvChips("genders");
  csvChips("categories");
  csvChips("brands");
  csvChips("sizes", (v) => `Size ${sizeTokenValue(v)}`);
  csvChips("conditions");
  csvChips("colors");
  csvChips("locations");

  // Price collapses to a single, readable chip.
  const min = u.current.get("minPrice");
  const max = u.current.get("maxPrice");
  if (min || max) {
    const label =
      min && max
        ? `${formatCurrency(Number(min))} – ${formatCurrency(Number(max))}`
        : max
          ? `Under ${formatCurrency(Number(max))}`
          : `Over ${formatCurrency(Number(min))}`;
    chips.push({
      key: "price",
      label,
      remove: () => {
        u.setScalar("minPrice", undefined);
        u.setScalar("maxPrice", undefined);
      },
    });
  }

  // Marketplaces only matter when narrowed from "all".
  const markets = u.current.get("markets")?.split(",").filter(Boolean) ?? [];
  if (markets.length > 0 && markets.length < MARKETPLACES.length) {
    for (const m of markets) {
      chips.push({
        key: `market:${m}`,
        label: MARKETPLACE_LABELS[m as Marketplace] ?? m,
        remove: () => u.toggleMarketplace(m),
      });
    }
  }

  for (const [key, label] of [
    ["freeShipping", "Free shipping"],
    ["verifiedSeller", "Verified seller"],
    ["newlyListed", "Newly listed"],
  ] as const) {
    if (u.current.get(key)) {
      chips.push({ key, label, remove: () => u.toggleBool(key) });
    }
  }

  if (chips.length === 0) return null;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.remove}
          aria-label={`Remove filter: ${chip.label}`}
          className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1.5 pl-3 pr-2 text-xs font-medium text-foreground shadow-sm transition-colors hover:border-foreground/30 hover:bg-accent"
        >
          {chip.label}
          <X className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
        </button>
      ))}
      <button
        type="button"
        onClick={u.clearFilters}
        className="rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}
