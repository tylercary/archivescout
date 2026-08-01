"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
  MARKETPLACES,
  MARKETPLACE_LABELS,
  type Marketplace,
} from "@/lib/marketplaces/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All marketplaces" },
  ...MARKETPLACES.map((m) => ({ value: m, label: MARKETPLACE_LABELS[m] })),
];

/**
 * Context handed to a `renderSuggestions` slot — the seam for a future
 * autocomplete / recent / trending dropdown. See the prop docs below.
 */
export interface SearchSuggestionContext {
  /** The live input value. */
  query: string;
  /** Fill the input (e.g. when a suggestion is clicked). */
  setQuery: (value: string) => void;
  /** Submit the current input immediately. */
  submit: () => void;
  /** Dismiss the suggestions panel. */
  close: () => void;
}

interface SearchBarProps {
  defaultQuery?: string;
  defaultScope?: string; // "all" | Marketplace
  size?: "hero" | "compact";
  autoFocus?: boolean;
  className?: string;
  /** Override the input placeholder (the navbar wants a shorter one). */
  placeholder?: string;
  /** Called on submit (e.g. to record a recent search) before navigation. */
  onSubmit?: (query: string, marketplaces: Marketplace[]) => void;
  /**
   * Query-string keys to carry into the NEW search (e.g. `{ sort }` on the
   * results page). Only these survive a submit — every filter (size, brand,
   * category, condition, price) and pagination are intentionally dropped, so
   * changing the query never leaks incompatible filters into the next search.
   * `undefined`/empty values are skipped.
   */
  preserve?: Record<string, string | undefined>;
  /**
   * Extension seam for autocomplete / recent / trending suggestions — NOT
   * implemented yet. When provided, its output renders in a popover anchored
   * to the input while it's focused. The component already owns the input
   * value and focus state, so a future dropdown only has to render options and
   * call `setQuery`/`submit`. Left undefined here, so no suggestions show.
   */
  renderSuggestions?: (ctx: SearchSuggestionContext) => React.ReactNode;
}

export function SearchBar({
  defaultQuery = "",
  defaultScope = "all",
  size = "hero",
  autoFocus = false,
  className,
  placeholder = "Search Chanel runners, Carhartt pants, vintage Levi's…",
  onSubmit,
  preserve,
  renderSuggestions,
}: SearchBarProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState(defaultQuery);
  const [scope, setScope] = React.useState(defaultScope);
  const [focused, setFocused] = React.useState(false);
  // Unique per instance: the navbar renders this alongside the homepage hero
  // (and a separate mobile instance), and duplicate DOM ids would break the
  // <label for> association.
  const uid = React.useId();
  const inputId = `search-input-${uid}`;
  const scopeId = `search-scope-${uid}`;

  React.useEffect(() => setQuery(defaultQuery), [defaultQuery]);
  React.useEffect(() => setScope(defaultScope), [defaultScope]);

  const runSubmit = React.useCallback(() => {
    const q = query.trim();
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const marketplaces: Marketplace[] =
      scope === "all" ? [...MARKETPLACES] : [scope as Marketplace];
    if (scope !== "all") params.set("markets", scope);
    // Carry only the explicitly-preserved keys (e.g. sort). View mode lives in
    // local storage, so it persists across searches without a query param.
    for (const [key, value] of Object.entries(preserve ?? {})) {
      if (value) params.set(key, value);
    }
    setFocused(false);
    onSubmit?.(q, marketplaces);
    router.push(`/search?${params.toString()}`);
  }, [query, scope, preserve, onSubmit, router]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    runSubmit();
  };

  const suggestions = renderSuggestions?.({
    query,
    setQuery,
    submit: runSubmit,
    close: () => setFocused(false),
  });
  const showSuggestions = focused && Boolean(suggestions);

  const hero = size === "hero";

  return (
    <form
      onSubmit={submit}
      role="search"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        // Keep the panel open while focus moves within the search bar (e.g.
        // clicking a suggestion); close once focus leaves it entirely.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false);
      }}
      className={cn(
        "relative flex w-full flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm sm:flex-row sm:items-center sm:rounded-full sm:pl-5",
        hero ? "sm:h-16" : "sm:h-12",
        className,
      )}
    >
      {showSuggestions && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
          {suggestions}
        </div>
      )}
      <div className="flex flex-1 items-center gap-3">
        <Search
          className={cn("shrink-0 text-muted-foreground", hero ? "h-5 w-5" : "h-4 w-4")}
          aria-hidden
        />
        <label htmlFor={inputId} className="sr-only">
          Search fashion listings
        </label>
        <input
          id={inputId}
          type="search"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "w-full border-0 bg-transparent p-2 text-foreground outline-none placeholder:text-muted-foreground focus:ring-0",
            hero ? "text-base sm:text-lg" : "text-sm",
          )}
        />
      </div>

      <div className="flex items-center gap-2 sm:border-l sm:border-border sm:pl-2">
        <label htmlFor={scopeId} className="sr-only">
          Choose marketplaces
        </label>
        <div className="relative flex-1 sm:flex-none">
          <select
            id={scopeId}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className={cn(
              "w-full appearance-none rounded-full bg-secondary px-4 pr-9 text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:w-auto",
              hero ? "h-11" : "h-9",
            )}
          >
            {SCOPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <svg
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>

        <Button
          type="submit"
          shape="pill"
          size={hero ? "lg" : "sm"}
          className="shrink-0"
        >
          <Search className="h-4 w-4 sm:hidden" />
          <span className="hidden sm:inline">Search</span>
          <span className="sm:hidden">Go</span>
        </Button>
      </div>
    </form>
  );
}
