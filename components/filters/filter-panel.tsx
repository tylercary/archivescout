"use client";

import * as React from "react";
import { makeSizeToken, sizeTokenValue } from "@/lib/search/normalized-filters";
import { ChevronDown, Search, X } from "lucide-react";
import {
  CONDITIONS,
  MARKETPLACES,
  MARKETPLACE_LABELS,
  type SearchFacets,
  type Marketplace,
} from "@/lib/marketplaces/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  SIZE_FAMILY_LABELS,
  compareSizes,
  dominantSizeFamily,
  fillSizeScale,
  groupCategories,
  groupSizes,
  sizeFamily,
  sizeFamilyForCategories,
  sizeFamilyOfBucket,
} from "@/lib/search/taxonomy";
import { useFilterUpdater } from "./use-filter-updater";
import { cn } from "@/lib/utils";

interface FilterPanelProps {
  facets: SearchFacets;
  activeCount: number;
}

/** Department replaces the old "Gender" filter — the trade's own term. */
const DEPARTMENTS = ["Menswear", "Womenswear"] as const;

export function FilterPanel({ facets, activeCount }: FilterPanelProps) {
  const u = useFilterUpdater();

  const marketsSelected = new Set(
    u.current.get("markets")?.split(",").filter(Boolean) ?? [...MARKETPLACES],
  );
  const selectedCategories = u.getCsv("categories");
  const trustSelected = u.getCsv("trust");

  // Categories arrive with inconsistent marketplace labels — group them into a
  // stable hierarchy, showing only groups present in these results.
  const categoryGroups = React.useMemo(
    () => groupCategories(facets.categories),
    [facets.categories],
  );

  // Sizes are scale-specific: showing shoe sizes next to waist sizes is noise.
  // Prefer the scale implied by the selected categories; otherwise infer it
  // from the results (a "chanel runner" search is footwear even with no
  // category picked). `showAllSizes` always lets the user escape the guess.
  const [showAllSizes, setShowAllSizes] = React.useState(false);
  const family =
    sizeFamilyForCategories(selectedCategories) ?? dominantSizeFamily(facets.sizes);

  const allSizes = React.useMemo(
    () => [...facets.sizes].sort((a, b) => compareSizes(a.value, b.value)),
    [facets.sizes],
  );
  const sizeOptions = React.useMemo(() => {
    if (!family || showAllSizes) return allSizes;
    // Keep any size the user has already selected, even off-scale.
    const selected = new Set(u.getCsv("sizes").map(sizeTokenValue));
    const onScale = allSizes.filter(
      (s) => sizeFamilyOfBucket(s) === family || selected.has(s.value),
    );
    // Close the gaps left by partially-loaded results (no 9/9.5/11 between
    // 8.5 and 12) so the scale reads as a scale.
    return fillSizeScale(onScale, family).sort((a, b) =>
      compareSizes(a.value, b.value),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSizes, family, showAllSizes, u.current.get("sizes")]);

  // Sizes excluded because they belong to a different scale. Counted directly —
  // comparing list lengths breaks once gap-filling adds entries.
  const sizeGroups = React.useMemo(() => groupSizes(sizeOptions), [sizeOptions]);

  const hiddenSizeCount = React.useMemo(() => {
    if (!family) return 0;
    const selected = new Set(u.getCsv("sizes").map(sizeTokenValue));
    return allSizes.filter(
      (s) => sizeFamilyOfBucket(s) !== family && !selected.has(s.value),
    ).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSizes, family, u.current.get("sizes")]);

  return (
    <div className="flex flex-col divide-y divide-border">
      <div className="flex items-center justify-between pb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          Filters{activeCount > 0 && ` (${activeCount})`}
        </h2>
        {activeCount > 0 && (
          <button
            onClick={u.clearFilters}
            className="rounded px-1.5 py-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      {/* 1 ─ Department */}
      <Section title="Department" defaultOpen>
        <CheckList>
          {DEPARTMENTS.map((d) => (
            <Row key={d}>
              <Checkbox
                checked={u.getCsv("genders").includes(d)}
                onCheckedChange={() => u.toggleInCsv("genders", d)}
                label={d}
              />
            </Row>
          ))}
        </CheckList>
      </Section>

      {/* 2 ─ Category (hierarchical) */}
      {categoryGroups.length > 0 && (
        <Section title="Category" defaultOpen>
          <div className="space-y-3.5">
            {categoryGroups.map(({ group, items, total }) => (
              <CategoryGroupBlock
                key={group}
                group={group}
                items={items}
                total={total}
                selected={selectedCategories}
                onToggle={(v) => u.toggleInCsv("categories", v)}
              />
            ))}
          </div>
        </Section>
      )}

      {/* 3 ─ Trust (authentication + seller reputation) */}
      <Section title="Trust" defaultOpen>
        <CheckList>
          {TRUST_UI.map((o) => {
            const supported = o.supportedBy.some((m) => marketsSelected.has(m));
            return (
              <Row key={o.value}>
                <Checkbox
                  checked={trustSelected.includes(o.value)}
                  disabled={!supported}
                  onCheckedChange={() => u.toggleInCsv("trust", o.value)}
                  label={o.label}
                />
                {!supported && (
                  <p className="mt-0.5 pl-6 text-[0.7rem] leading-snug text-muted-foreground">
                    {o.unsupportedReason}
                  </p>
                )}
              </Row>
            );
          })}
        </CheckList>
      </Section>

      {/* 4 ─ Brand (searchable) */}
      {facets.brands.length > 0 && (
        <Section title="Brand" defaultOpen>
          <BrandSelector
            options={facets.brands}
            selected={u.getCsv("brands")}
            onToggle={(v) => u.toggleInCsv("brands", v)}
          />
        </Section>
      )}

      {/* 4 ─ Size (grouped by scale) */}
      {sizeOptions.length > 0 && (
        <Section title="Size" defaultOpen>
          {family && !showAllSizes && hiddenSizeCount > 0 && (
            <div className="mb-2.5 flex items-baseline justify-between gap-2">
              <p className="text-[0.7rem] text-muted-foreground">
                {SIZE_FAMILY_LABELS[family]} sizes
              </p>
              <button
                type="button"
                onClick={() => setShowAllSizes(true)}
                className="rounded px-1 py-0.5 text-[0.7rem] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Show all ({hiddenSizeCount})
              </button>
            </div>
          )}
          {showAllSizes && (
            <div className="mb-2.5 flex items-baseline justify-between gap-2">
              <p className="text-[0.7rem] text-muted-foreground">All sizes</p>
              <button
                type="button"
                onClick={() => setShowAllSizes(false)}
                className="rounded px-1 py-0.5 text-[0.7rem] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Show less
              </button>
            </div>
          )}

          {/* One grid per scale. A broad search returns shoe, clothing and
              waist sizes at once — mixing them in a single grid is unreadable. */}
          <div className="space-y-3">
            {sizeGroups.map(({ family: f, items }) => (
              <div key={f}>
                {sizeGroups.length > 1 && (
                  <p className="mb-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {SIZE_FAMILY_LABELS[f]}
                  </p>
                )}
                <div className="grid grid-cols-3 gap-1.5">
                  {items.map((s) => {
                    const active = u.getCsv("sizes").map(sizeTokenValue).includes(s.value);
                    // count === 0 means the size wasn't in the loaded page —
                    // still a valid search, just shown quieter.
                    const unloaded = s.count === 0;
                    return (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() =>
                          u.toggleInCsv(
                            "sizes",
                            u.getCsv("sizes").find((tk) => sizeTokenValue(tk) === s.value) ??
                              makeSizeToken(family, s.value),
                          )
                        }
                        aria-pressed={active}
                        title={
                          unloaded
                            ? `${s.value} — search this size`
                            : `${s.value} — ${s.count.toLocaleString()} listing${s.count === 1 ? "" : "s"}`
                        }
                        className={cn(
                          "flex h-9 items-center justify-center rounded-md border px-1 text-xs font-medium transition-colors",
                          active
                            ? "border-foreground bg-foreground text-background"
                            : unloaded
                              ? "border-input/60 text-muted-foreground hover:border-foreground/40 hover:bg-accent hover:text-foreground"
                              : "border-input text-foreground hover:border-foreground/40 hover:bg-accent",
                        )}
                      >
                        {s.value}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 5 ─ Price */}
      <Section title="Price" defaultOpen>
        <PriceFilter
          min={u.current.get("minPrice") ?? ""}
          max={u.current.get("maxPrice") ?? ""}
          range={facets.priceRange}
          onCommit={(minV, maxV) => {
            u.setScalar("minPrice", minV || undefined);
            u.setScalar("maxPrice", maxV || undefined);
          }}
        />
      </Section>

      {/* 6 ─ Condition */}
      <Section title="Condition" defaultOpen>
        <CheckList>
          {CONDITIONS.map((c) => {
            const count = countFor(facets.conditions, c);
            return (
              <Row key={c} count={count}>
                <Checkbox
                  checked={u.getCsv("conditions").includes(c)}
                  onCheckedChange={() => u.toggleInCsv("conditions", c)}
                  label={c}
                />
              </Row>
            );
          })}
        </CheckList>
      </Section>

      {/* 7 ─ Marketplace */}
      <Section title="Marketplace" defaultOpen>
        <CheckList>
          {MARKETPLACES.map((m) => (
            <Row key={m}>
              <Checkbox
                checked={marketsSelected.has(m)}
                onCheckedChange={() => u.toggleMarketplace(m)}
                label={MARKETPLACE_LABELS[m]}
              />
            </Row>
          ))}
        </CheckList>
      </Section>

      {/* 8 ─ Color */}
      {facets.colors.length > 0 && (
        <Section title="Color">
          <CheckList>
            {facets.colors.map((c) => (
              <Row key={c.value} count={c.count}>
                <Checkbox
                  checked={u.getCsv("colors").includes(c.value)}
                  onCheckedChange={() => u.toggleInCsv("colors", c.value)}
                  label={c.value}
                />
              </Row>
            ))}
          </CheckList>
        </Section>
      )}

      {/* 9 ─ Location */}
      {facets.locations.length > 0 && (
        <Section title="Location">
          <CheckList>
            {facets.locations.map((l) => (
              <Row key={l.value} count={l.count}>
                <Checkbox
                  checked={u.getCsv("locations").includes(l.value)}
                  onCheckedChange={() => u.toggleInCsv("locations", l.value)}
                  label={l.value}
                />
              </Row>
            ))}
          </CheckList>
        </Section>
      )}

      {/* Secondary toggles, kept last so the primary scales lead */}
      <Section title="Options">
        <CheckList>
          <Row>
            <Checkbox
              checked={!!u.current.get("freeShipping")}
              onCheckedChange={() => u.toggleBool("freeShipping")}
              label="Free shipping"
            />
          </Row>
          <Row>
            <Checkbox
              checked={!!u.current.get("verifiedSeller")}
              onCheckedChange={() => u.toggleBool("verifiedSeller")}
              label="Verified seller"
            />
          </Row>
          <Row>
            <Checkbox
              checked={!!u.current.get("newlyListed")}
              onCheckedChange={() => u.toggleBool("newlyListed")}
              label="Newly listed (7 days)"
            />
          </Row>
        </CheckList>
      </Section>
    </div>
  );
}

function countFor(buckets: { value: string; count: number }[], value: string) {
  return buckets.find((b) => b.value === value)?.count ?? 0;
}

/**
 * One category group. Long tails are collapsed to the top few so a broad search
 * (Grailed returns 100+ categories for "chanel") stays scannable.
 */
function CategoryGroupBlock({
  group,
  items,
  total,
  selected,
  onToggle,
}: {
  group: string;
  items: { value: string; count: number }[];
  total: number;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const COLLAPSED = 6;
  const [expanded, setExpanded] = React.useState(false);
  // Always keep selected values visible, even beyond the cut-off.
  const visible = expanded
    ? items
    : items.filter((i, idx) => idx < COLLAPSED || selected.includes(i.value));
  const hidden = items.length - visible.length;

  return (
    <div>
      <p className="mb-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {group}
        <span className="ml-1.5 font-normal tabular-nums opacity-70">
          {total.toLocaleString()}
        </span>
      </p>
      <CheckList className="pl-0.5">
        {visible.map((item) => (
          <Row key={item.value} count={item.count}>
            <Checkbox
              checked={selected.includes(item.value)}
              onCheckedChange={() => onToggle(item.value)}
              label={item.value}
            />
          </Row>
        ))}
      </CheckList>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 rounded px-1.5 py-1 text-[0.7rem] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          +{hidden} more
        </button>
      )}
      {expanded && items.length > COLLAPSED && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-1 rounded px-1.5 py-1 text-[0.7rem] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Show less
        </button>
      )}
    </div>
  );
}

/* ───────────── layout helpers: roomier rows, bigger hit targets ───────────── */

function CheckList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("space-y-0.5", className)}>{children}</div>;
}

/** One filter row: full-width target, comfortable height, count on the right. */
function Row({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-accent/60">
      <div className="min-w-0 flex-1">{children}</div>
      {count !== undefined && count > 0 && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </div>
  );
}

/**
 * Trust options and which marketplaces can actually satisfy each one —
 * discovered from live API payloads, not assumed. Unsupported options stay
 * VISIBLE but disabled with the reason, so the capability gap is legible.
 */
const TRUST_UI: {
  value: string;
  label: string;
  supportedBy: Marketplace[];
  unsupportedReason: string;
}[] = [
  {
    value: "authenticated",
    label: "Marketplace Authenticated",
    supportedBy: [],
    unsupportedReason:
      "No connected marketplace exposes listing-level authentication. Grailed authenticates at checkout, not per listing.",
  },
  {
    value: "guarantee",
    label: "Authenticity Guarantee",
    supportedBy: ["ebay"],
    unsupportedReason: "eBay's Authenticity Guarantee — select eBay to use this.",
  },
  {
    value: "trusted",
    label: "Trusted Seller",
    supportedBy: ["ebay", "grailed"],
    unsupportedReason: "Select a marketplace that publishes seller reputation.",
  },
];

/* ─────────────────────────── Section ─────────────────────────── */
function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  // Expand/collapse preference persists for the SESSION (sessionStorage, not
  // local storage) so refining a search doesn't re-open everything the user
  // deliberately collapsed. Read lazily to stay SSR-safe.
  const storageKey = `archivescout:filter-section:${title}`;
  const [open, setOpen] = React.useState(defaultOpen);
  React.useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved !== null) setOpen(saved === "1");
    } catch {
      /* private mode — fall back to defaultOpen */
    }
  }, [storageKey]);
  const toggle = () =>
    setOpen((o) => {
      const next = !o;
      try {
        window.sessionStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  const id = React.useId();
  return (
    <div className="py-3.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center justify-between rounded-md py-1 text-left"
      >
        <span className="text-sm font-medium text-foreground">{title}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div id={id} className="mt-3">
          {children}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Price ─────────────────────────── */
function PriceFilter({
  min,
  max,
  range,
  onCommit,
}: {
  min: string;
  max: string;
  range: { min: number; max: number };
  onCommit: (min: string, max: string) => void;
}) {
  const [localMin, setLocalMin] = React.useState(min);
  const [localMax, setLocalMax] = React.useState(max);

  React.useEffect(() => setLocalMin(min), [min]);
  React.useEffect(() => setLocalMax(max), [max]);

  const commit = () => onCommit(localMin.trim(), localMax.trim());

  return (
    <div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          aria-label="Minimum price"
          placeholder={range.min ? `${range.min}` : "Min"}
          value={localMin}
          onChange={(e) => setLocalMin(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
        <span className="text-muted-foreground">–</span>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          aria-label="Maximum price"
          placeholder={range.max ? `${range.max}` : "Max"}
          value={localMax}
          onChange={(e) => setLocalMax(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
      </div>
      <Button variant="secondary" size="sm" className="mt-2.5 w-full" onClick={commit}>
        Apply price
      </Button>
    </div>
  );
}

/* ─────────────────── Brand: search + chips + checklist ─────────────────── */
function BrandSelector({
  options,
  selected,
  onToggle,
}: {
  options: { value: string; count: number }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  const selectedSet = new Set(selected);

  // Selected brands always stay visible at the top as removable chips; the list
  // below shows what's left, filtered by the search box.
  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return options
      .filter((o) => !selectedSet.has(o.value))
      .filter((o) => (q ? o.value.toLowerCase().includes(q) : true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, query, selected.join(",")]);

  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {selected.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => onToggle(b)}
              aria-label={`Remove ${b} filter`}
              className="inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-xs font-medium text-background transition-opacity hover:opacity-85"
            >
              {b}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search brands…"
          aria-label="Search brands"
          className="h-9 pl-8"
        />
      </div>

      <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto pr-1">
        {visible.map((o) => (
          <Row key={o.value} count={o.count}>
            <Checkbox
              checked={false}
              onCheckedChange={() => onToggle(o.value)}
              label={o.value}
            />
          </Row>
        ))}
        {visible.length === 0 && (
          <p className="px-1.5 py-2 text-xs text-muted-foreground">
            {query ? "No brands match" : "All brands selected"}
          </p>
        )}
      </div>
    </div>
  );
}
