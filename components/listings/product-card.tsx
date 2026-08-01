"use client";

import * as React from "react";
import { ArrowUpRight, Eye } from "lucide-react";
import type { EnrichedListing } from "@/lib/marketplaces/types";
import { formatCurrency, timeAgo } from "@/lib/utils";
import { MarketplaceBadge } from "./marketplace-badge";
import { FavoriteButton } from "./favorite-button";
import { CompareToggle } from "./compare-toggle";
import { SellerRating } from "./seller-rating";
import { AuthenticationBadge } from "./authentication-badge";
import { ListingImage } from "./listing-image";
import { cn } from "@/lib/utils";

interface ProductCardProps {
  listing: EnrichedListing;
  onQuickView?: (listing: EnrichedListing) => void;
  view?: "grid" | "list";
  priority?: boolean;
  /** An eBay size facet filtered this search but the item exposes no
   *  displayable size — show a subtle provenance note, NEVER the filter value
   *  presented as item metadata. */
  sizeFacetNote?: boolean;
}

export function ProductCard({
  listing,
  onQuickView,
  view = "grid",
  priority = false,
  sizeFacetNote = false,
}: ProductCardProps) {
  if (view === "list") return <ListRow listing={listing} onQuickView={onQuickView} />;

  return (
    <article className="group relative flex flex-col animate-fade-in">
      {/* Image + overlays */}
      <div className="relative aspect-[4/5] overflow-hidden rounded-lg border border-border bg-muted">
        <a
          href={listing.listingUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View "${listing.title}" on ${listing.marketplace} (opens in new tab)`}
          className="block h-full w-full"
        >
          <ListingImage
            src={listing.imageUrls[0]}
            alt={listing.title}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            priority={priority}
            className="transition-transform duration-500 ease-out group-hover:scale-[1.04]"
          />
        </a>

        {/* Top-left: marketplace badge */}
        <div className="pointer-events-none absolute left-2.5 top-2.5">
          <MarketplaceBadge marketplace={listing.marketplace} />
        </div>

        {/* Top-right: favorite + compare */}
        <div className="absolute right-2.5 top-2.5 z-10 flex flex-col gap-1.5">
          <FavoriteButton listing={listing} />
          <CompareToggle listing={listing} />
        </div>

        {/* Bottom: quick view + view listing (revealed on hover) */}
        <div className="absolute inset-x-2.5 bottom-2.5 z-10 flex translate-y-2 gap-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
          {onQuickView && (
            <button
              type="button"
              onClick={() => onQuickView(listing)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-card/95 px-3 py-2 text-xs font-semibold text-foreground shadow-md backdrop-blur transition-colors hover:bg-card"
            >
              <Eye className="h-3.5 w-3.5" />
              Quick view
            </button>
          )}
          <a
            href={listing.listingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-xs font-semibold text-background shadow-md transition-colors hover:bg-foreground/90"
          >
            View listing
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {/* Meta — fixed row rhythm so every card in a row ends at the same height */}
      <div className="mt-3 flex flex-1 flex-col">
        <div className="flex min-h-4 items-center justify-between gap-2">
          <p className="truncate text-[0.68rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            {listing.brand ?? "—"}
          </p>
          {listing.listedAt && (
            // Relative time drifts between server render and client hydration
            // (e.g. "36m ago" vs "37m ago") — suppress that expected mismatch.
            <span
              suppressHydrationWarning
              className="shrink-0 text-[0.68rem] text-muted-foreground"
            >
              {timeAgo(listing.listedAt)}
            </span>
          )}
        </div>

        {/* Reserve two lines so titles of different lengths stay aligned. */}
        <h3 className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-foreground">
          <a
            href={listing.listingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="after:absolute after:inset-0 after:content-[''] hover:underline"
          >
            {listing.title}
          </a>
        </h3>

        <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {listing.size && <span>Size {listing.size}</span>}
          <AuthenticationBadge listing={listing} />
          {!listing.size && sizeFacetNote && listing.marketplace === "ebay" && (
            <span className="text-muted-foreground/70">
              Filtered by eBay size facet
            </span>
          )}
          <AuthenticationBadge listing={listing} />
          {listing.condition && (
            <span className="rounded border border-border bg-secondary px-1.5 py-0.5 text-[0.65rem] font-medium text-foreground/80">
              {listing.condition}
            </span>
          )}
        </div>

        {/* Price leads; shipping and total stay quiet underneath. */}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2.5">
          <div className="min-w-0">
            <p className="text-lg font-semibold tracking-tight text-foreground">
              {formatCurrency(listing.price, listing.currency)}
            </p>
            <p className="mt-0.5 truncate text-[0.68rem] text-muted-foreground">
              {listing.isFreeShipping
                ? "Free shipping"
                : `+ ${formatCurrency(listing.shippingPrice ?? 0, listing.currency)} shipping`}
              {" · "}
              {formatCurrency(listing.totalPrice, listing.currency)} total
            </p>
          </div>
          <SellerRating rating={listing.sellerRating} className="mb-1" />
        </div>
      </div>
    </article>
  );
}

function ListRow({
  listing,
  onQuickView,
}: {
  listing: EnrichedListing;
  onQuickView?: (l: EnrichedListing) => void;
}) {
  return (
    <article className="group relative flex gap-4 rounded-lg border border-border bg-card p-3 transition-shadow hover:shadow-md animate-fade-in sm:gap-5 sm:p-4">
      <div className="relative aspect-[4/5] w-24 shrink-0 overflow-hidden rounded-md border border-border bg-muted sm:w-32">
        <a href={listing.listingUrl} target="_blank" rel="noopener noreferrer">
          <ListingImage
            src={listing.imageUrls[0]}
            alt={listing.title}
            sizes="128px"
            className="transition-transform duration-500 group-hover:scale-105"
          />
        </a>
        <div className="pointer-events-none absolute left-1.5 top-1.5">
          <MarketplaceBadge marketplace={listing.marketplace} showDot={false} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {listing.brand ?? "—"}
            </p>
            <h3 className="mt-0.5 line-clamp-2 text-sm font-medium text-foreground sm:text-base">
              <a
                href={listing.listingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {listing.title}
              </a>
            </h3>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <FavoriteButton listing={listing} size="sm" />
            <CompareToggle listing={listing} className="h-8 w-8" />
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {listing.size && <span>Size {listing.size}</span>}
          {listing.condition && (
            <>
              <Dot />
              <span>{listing.condition}</span>
            </>
          )}
          {listing.location && (
            <>
              <Dot />
              <span>{listing.location}</span>
            </>
          )}
          {listing.listedAt && (
            <>
              <Dot />
              {/* Relative time drifts between server render and hydration. */}
              <span suppressHydrationWarning>{timeAgo(listing.listedAt)}</span>
            </>
          )}
        </div>

        <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-2">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold text-foreground">
              {formatCurrency(listing.price, listing.currency)}
            </span>
            <span className="text-xs text-muted-foreground">
              {listing.isFreeShipping
                ? "Free shipping"
                : `+ ${formatCurrency(listing.shippingPrice ?? 0, listing.currency)}`}{" "}
              · {formatCurrency(listing.totalPrice, listing.currency)} total
            </span>
          </div>
          <div className="flex items-center gap-3">
            <SellerRating rating={listing.sellerRating} />
            {onQuickView && (
              <button
                type="button"
                onClick={() => onQuickView(listing)}
                className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                <Eye className="h-3.5 w-3.5" /> Quick view
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function Dot() {
  return <span aria-hidden className="text-border">·</span>;
}
