"use client";

import Link from "next/link";
import { ArrowUpRight, Check, Scale, Search, Trophy, X } from "lucide-react";
import { useCompare } from "@/lib/store/compare";
import { computeHighlights, totalOf } from "@/lib/compare";
import { formatCurrency, cn } from "@/lib/utils";
import { MarketplaceBadge } from "@/components/listings/marketplace-badge";
import { ListingImage } from "@/components/listings/listing-image";
import { FavoriteButton } from "@/components/listings/favorite-button";
import { SellerRating } from "@/components/listings/seller-rating";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function CompareView() {
  const { items, remove, clear, hydrated } = useCompare();
  const highlights = computeHighlights(items);

  if (!hydrated) {
    return (
      <div className="container py-10">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-8 h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="container py-8 sm:py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Side by side</p>
          <h1 className="mt-1.5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Compare listings
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {items.length} of 4 selected. The best value in each row is
            highlighted.
          </p>
        </div>
        {items.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clear}>
            <X className="h-4 w-4" />
            Clear all
          </Button>
        )}
      </header>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/30 px-6 py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-card shadow-sm">
            <Scale className="h-7 w-7 text-muted-foreground" />
          </div>
          <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight">
            Nothing to compare yet
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Add up to four listings with the compare button on any card, then
            line them up here.
          </p>
          <Button asChild className="mt-6">
            <Link href="/search">
              <Search className="h-4 w-4" />
              Find listings
            </Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto pb-4">
          <table className="w-full min-w-[640px] border-separate border-spacing-0">
            <thead>
              <tr>
                <th scope="col" className="w-36 p-0" />
                {items.map((l) => (
                  <th key={l.id} scope="col" className="p-2 align-top">
                    <div className="relative overflow-hidden rounded-lg border border-border bg-card">
                      <div className="relative aspect-[4/5] w-full bg-muted">
                        <ListingImage
                          src={l.imageUrls[0]}
                          alt={l.title}
                          sizes="220px"
                        />
                        <button
                          onClick={() => remove(l.id)}
                          aria-label={`Remove ${l.title}`}
                          className="absolute right-2 top-2 rounded-full bg-card/90 p-1.5 text-foreground shadow-sm backdrop-blur hover:bg-card"
                        >
                          <X className="h-4 w-4" />
                        </button>
                        <div className="absolute left-2 top-2">
                          <MarketplaceBadge marketplace={l.marketplace} showDot={false} />
                        </div>
                        <div className="absolute bottom-2 right-2">
                          <FavoriteButton listing={l} size="sm" />
                        </div>
                      </div>
                      <div className="p-3 text-left">
                        <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                          {l.brand ?? "—"}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-foreground">
                          {l.title}
                        </p>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-sm">
              <Row
                label="Price"
                items={items}
                render={(l) => formatCurrency(l.price, l.currency)}
                bestId={highlights.lowestPriceId}
                bestNote="Lowest"
              />
              <Row
                label="Shipping"
                items={items}
                render={(l) =>
                  (l.shippingPrice ?? 0) === 0
                    ? "Free"
                    : formatCurrency(l.shippingPrice ?? 0, l.currency)
                }
              />
              <Row
                label="Total cost"
                items={items}
                render={(l) => formatCurrency(totalOf(l), l.currency)}
                bestId={highlights.lowestTotalId}
                bestNote="Best value"
                emphasize
              />
              <Row label="Size" items={items} render={(l) => l.size ?? "—"} />
              <Row label="Condition" items={items} render={(l) => l.condition ?? "—"} />
              <Row
                label="Marketplace"
                items={items}
                render={(l) => <MarketplaceBadge marketplace={l.marketplace} showDot={false} />}
              />
              <Row
                label="Seller rating"
                items={items}
                render={(l) =>
                  l.sellerRating !== undefined ? <SellerRating rating={l.sellerRating} /> : "—"
                }
                bestId={highlights.bestRatingId}
                bestNote="Top rated"
              />
              <Row
                label="Listed"
                items={items}
                render={(l) =>
                  l.listedAt
                    ? new Date(l.listedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "—"
                }
                bestId={highlights.newestId}
                bestNote="Newest"
              />
              <tr>
                <td className="p-2" />
                {items.map((l) => (
                  <td key={l.id} className="p-2 align-top">
                    <Button asChild size="sm" className="w-full">
                      <a href={l.listingUrl} target="_blank" rel="noopener noreferrer">
                        View listing
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  items,
  render,
  bestId,
  bestNote,
  emphasize,
}: {
  label: string;
  items: ReturnType<typeof useCompare>["items"];
  render: (l: ReturnType<typeof useCompare>["items"][number]) => React.ReactNode;
  bestId?: string;
  bestNote?: string;
  emphasize?: boolean;
}) {
  return (
    <tr>
      <th
        scope="row"
        className="border-t border-border py-3 pr-4 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </th>
      {items.map((l) => {
        const best = bestId === l.id;
        return (
          <td
            key={l.id}
            className={cn(
              "border-t border-border p-2 align-middle",
            )}
          >
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-2",
                best &&
                  "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
                emphasize && "font-semibold text-foreground",
              )}
            >
              {best && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
              <span className="min-w-0">{render(l)}</span>
              {best && bestNote && (
                <span className="ml-auto hidden items-center gap-0.5 whitespace-nowrap rounded-full bg-emerald-600/10 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 sm:inline-flex">
                  <Trophy className="h-2.5 w-2.5" />
                  {bestNote}
                </span>
              )}
            </div>
          </td>
        );
      })}
    </tr>
  );
}
