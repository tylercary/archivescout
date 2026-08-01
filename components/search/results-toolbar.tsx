"use client";

import * as React from "react";
import { Bookmark, BookmarkCheck, LayoutGrid, List, SlidersHorizontal } from "lucide-react";
import {
  SORT_LABELS,
  VISIBLE_SORT_OPTIONS,
  type SearchParams,
  type SortOption,
} from "@/lib/marketplaces/types";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useSearches } from "@/lib/store/searches";
import { cn } from "@/lib/utils";

interface ResultsToolbarProps {
  params: SearchParams;
  sort: SortOption;
  onSortChange: (sort: string) => void;
  view: "grid" | "list";
  onViewChange: (view: "grid" | "list") => void;
  onOpenFilters: () => void;
  activeFilterCount: number;
}

export function ResultsToolbar({
  params,
  sort,
  onSortChange,
  view,
  onViewChange,
  onOpenFilters,
  activeFilterCount,
}: ResultsToolbarProps) {
  const { saveSearch, isSaved, removeSaved, saved, hydrated } = useSearches();
  const saved_ = hydrated && isSaved(params.query);

  const onToggleSave = () => {
    if (saved_) {
      const match = saved.find(
        (s) => s.query.toLowerCase() === params.query.trim().toLowerCase(),
      );
      if (match) removeSaved(match.id);
    } else {
      saveSearch({
        query: params.query,
        marketplaces: params.marketplaces,
        filters: params.filters,
        sort: params.sort,
        maxDesiredPrice: params.filters.maxPrice,
        priceAlert: false,
      });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="lg:hidden"
        onClick={onOpenFilters}
      >
        <SlidersHorizontal className="h-4 w-4" />
        Filters
        {activeFilterCount > 0 && (
          <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.68rem] font-semibold text-primary-foreground">
            {activeFilterCount}
          </span>
        )}
      </Button>

      {params.query && (
        <Button
          variant={saved_ ? "secondary" : "outline"}
          size="sm"
          onClick={onToggleSave}
          aria-pressed={saved_}
        >
          {saved_ ? (
            <BookmarkCheck className="h-4 w-4" />
          ) : (
            <Bookmark className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">
            {saved_ ? "Search saved" : "Save search"}
          </span>
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <label htmlFor="sort" className="sr-only">
          Sort results
        </label>
        <Select
          id="sort"
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          options={VISIBLE_SORT_OPTIONS.map((s) => ({
            value: s,
            label: SORT_LABELS[s],
          }))}
          className="min-w-[10.5rem]"
        />

        <div
          className="flex items-center rounded-md border border-input p-0.5"
          role="group"
          aria-label="View mode"
        >
          <ViewButton
            active={view === "grid"}
            onClick={() => onViewChange("grid")}
            label="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </ViewButton>
          <ViewButton
            active={view === "list"}
            onClick={() => onViewChange("list")}
            label="List view"
          >
            <List className="h-4 w-4" />
          </ViewButton>
        </div>
      </div>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
