"use client";

import Link from "next/link";
import { ArrowUpRight, Scale, Trophy, X } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useCompare } from "@/lib/store/compare";
import { computeHighlights } from "@/lib/compare";
import { formatCurrency, cn } from "@/lib/utils";
import { MarketplaceBadge } from "./marketplace-badge";
import { ListingImage } from "./listing-image";
import { useListingsDetails } from "./use-listing-details";

/** Global comparison drawer, mounted once in the root layout. */
export function CompareDrawer() {
  const { items: rawItems, drawerOpen, setDrawerOpen, remove, clear } = useCompare();
  // Fill missing eBay Size/Brand/Color from item details while the drawer is
  // open (cached per item; never fires during normal browsing).
  const items = useListingsDetails(rawItems, drawerOpen);
  const highlights = computeHighlights(items);

  return (
    <Sheet
      open={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      side="right"
      label="Compare listings"
    >
      <div className="flex h-full flex-col">
        <div className="border-b border-border p-5 pr-14">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Scale className="h-5 w-5" />
            Compare ({items.length}/4)
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Best value in each column is highlighted.
          </p>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
              <Scale className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              Add up to four listings using the{" "}
              <Scale className="inline h-3.5 w-3.5" /> button on any card.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <ul className="space-y-3">
              {items.map((l) => {
                const total = l.price + (l.shippingPrice ?? 0);
                return (
                  <li
                    key={l.id}
                    className="relative flex gap-3 rounded-lg border border-border bg-card p-3"
                  >
                    <div className="relative aspect-[4/5] w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                      <ListingImage src={l.imageUrls[0]} alt={l.title} sizes="64px" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <MarketplaceBadge marketplace={l.marketplace} showDot={false} />
                        <button
                          onClick={() => remove(l.id)}
                          aria-label={`Remove ${l.title} from comparison`}
                          className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="mt-1 line-clamp-1 text-sm font-medium text-foreground">
                        {l.title}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Stat
                          label="Price"
                          value={formatCurrency(l.price, l.currency)}
                          best={highlights.lowestPriceId === l.id}
                        />
                        <Stat
                          label="Total"
                          value={formatCurrency(total, l.currency)}
                          best={highlights.lowestTotalId === l.id}
                        />
                        {l.sellerRating !== undefined && (
                          <Stat
                            label="Seller"
                            value={l.sellerRating.toFixed(1)}
                            best={highlights.bestRatingId === l.id}
                          />
                        )}
                        {highlights.newestId === l.id && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-[0.65rem] font-semibold text-background">
                            <Trophy className="h-3 w-3" /> Newest
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="space-y-2 border-t border-border p-4">
          <Button
            asChild
            size="lg"
            className="w-full"
            disabled={items.length < 2}
          >
            <Link
              href="/compare"
              onClick={() => setDrawerOpen(false)}
              aria-disabled={items.length < 2}
              className={cn(items.length < 2 && "pointer-events-none opacity-50")}
            >
              Open full comparison
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </Button>
          {items.length > 0 && (
            <Button variant="ghost" size="sm" className="w-full" onClick={clear}>
              Clear all
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Stat({
  label,
  value,
  best,
}: {
  label: string;
  value: string;
  best?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.65rem]",
        best
          ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "border-border bg-secondary text-muted-foreground",
      )}
    >
      <span className="uppercase tracking-wide">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}