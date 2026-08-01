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
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth-context";
import { useSavedSearches } from "@/lib/saved-searches/use-saved-searches";
import { toSavedSearchPayload } from "@/lib/saved-searches/serializer";
import { toQueryString } from "@/lib/search/params";
import { SaveSearchDialog } from "@/components/searches/save-search-dialog";
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
  const router = useRouter();
  const { user, configured } = useAuth();
  const { findMatching } = useSavedSearches();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // Identity is the FULL normalized search, so "chanel runners" and
  // "chanel runners + size 13" are tracked as different saved searches.
  const searchQueryString = toQueryString(params);
  const payload = React.useMemo(() => toSavedSearchPayload(params), [searchQueryString]); // eslint-disable-line react-hooks/exhaustive-deps
  const existing = findMatching(payload);
  const saved_ = Boolean(existing);

  const onToggleSave = () => {
    // Signed out → send to sign-in and come straight back to this exact
    // search, with the save dialog reopening automatically.
    if (!user) {
      const here = `/search?${searchQueryString}`;
      const next = `${here}${searchQueryString ? "&" : "?"}save=1`;
      router.push(`/signin?next=${encodeURIComponent(next)}`);
      return;
    }
    setDialogOpen(true);
  };

  // Resume the save flow after sign-in (?save=1), then clean the URL.
  React.useEffect(() => {
    if (!user) return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("save") !== "1") return;
    setDialogOpen(true);
    sp.delete("save");
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `/search?${qs}` : "/search");
  }, [user]);

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
            {saved_ ? "Saved ✓" : "Save search"}
          </span>
        </Button>
      )}

      {configured && (
        <SaveSearchDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          payload={payload}
          searchQueryString={searchQueryString}
          existing={existing}
        />
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
