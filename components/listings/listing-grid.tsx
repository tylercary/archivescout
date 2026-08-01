"use client";

import * as React from "react";
import type { EnrichedListing } from "@/lib/marketplaces/types";
import { ProductCard } from "./product-card";
import { QuickView } from "./quick-view";
import { cn } from "@/lib/utils";

interface ListingGridProps {
  listings: EnrichedListing[];
  view?: "grid" | "list";
  priorityCount?: number;
  className?: string;
  /** Search had an active size filter — cards may show the facet note. */
  sizeFilterActive?: boolean;
}

/** Renders listings and owns the quick-view modal state. */
export function ListingGrid({
  listings,
  view = "grid",
  priorityCount = 4,
  className,
  sizeFilterActive = false,
}: ListingGridProps) {
  const [quickView, setQuickView] = React.useState<EnrichedListing | null>(null);

  return (
    <>
      <div
        className={cn(
          view === "grid"
            ? "grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4"
            : "flex flex-col gap-3",
          className,
        )}
      >
        {listings.map((listing, i) => (
          <ProductCard
            key={listing.id}
            listing={listing}
            view={view}
            priority={i < priorityCount}
            sizeFacetNote={sizeFilterActive}
            onQuickView={setQuickView}
          />
        ))}
      </div>

      <QuickView listing={quickView} onClose={() => setQuickView(null)} />
    </>
  );
}
