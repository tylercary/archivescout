"use client";

import * as React from "react";
import Image from "next/image";
import { ArrowUpRight, MapPin } from "lucide-react";
import type { EnrichedListing } from "@/lib/marketplaces/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { MarketplaceBadge } from "./marketplace-badge";
import { FavoriteButton } from "./favorite-button";
import { CompareToggle } from "./compare-toggle";
import { SellerRating } from "./seller-rating";
import { ListingImage } from "./listing-image";
import { trustSignals } from "./authentication-badge";
import { useListingDetails } from "./use-listing-details";
import { cn } from "@/lib/utils";

export function QuickView({
  listing: source,
  onClose,
}: {
  listing: EnrichedListing | null;
  onClose: () => void;
}) {
  // Lazily fill fields the search feed omits (eBay Size/Brand/Color aspects).
  // Summary data renders instantly; verified details merge in when they land.
  const {
    listing,
    loading: detailsLoading,
    unavailable,
    verifiedSize,
  } = useListingDetails(source);
  const [active, setActive] = React.useState(0);

  React.useEffect(() => setActive(0), [listing?.id]);

  const open = listing !== null;

  return (
    <Dialog open={open} onClose={onClose} label={listing?.title ?? "Listing details"}>
      {listing && (
        <div className="grid max-h-[85vh] grid-cols-1 overflow-y-auto md:grid-cols-2 md:overflow-hidden">
          {/* Gallery */}
          <div className="flex flex-col gap-3 border-b border-border p-4 md:border-b-0 md:border-r md:p-5">
            <div className="relative aspect-[4/5] overflow-hidden rounded-md border border-border bg-muted">
              <ListingImage
                src={listing.imageUrls[active]}
                alt={`${listing.title} — image ${active + 1}`}
                sizes="(max-width: 768px) 100vw, 40vw"
              />
              <div className="absolute left-3 top-3">
                <MarketplaceBadge marketplace={listing.marketplace} />
              </div>
            </div>
            {listing.imageUrls.length > 1 && (
              <div className="flex gap-2" role="tablist" aria-label="Product images">
                {listing.imageUrls.map((url, i) => (
                  <button
                    key={url}
                    role="tab"
                    aria-selected={i === active}
                    aria-label={`View image ${i + 1}`}
                    onClick={() => setActive(i)}
                    className={cn(
                      "relative aspect-square w-16 overflow-hidden rounded-md border transition-all",
                      i === active
                        ? "border-foreground ring-1 ring-foreground"
                        : "border-border opacity-70 hover:opacity-100",
                    )}
                  >
                    <Image src={url} alt="" fill sizes="64px" className="object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="flex flex-col overflow-y-auto p-5 md:p-6">
            <p className="eyebrow">{listing.brand ?? "Unbranded"}</p>
            <h2 className="mt-1.5 text-xl font-semibold leading-tight tracking-tight text-foreground">
              {listing.title}
            </h2>

            <div className="mt-4 flex items-end gap-3">
              <span className="text-2xl font-semibold text-foreground">
                {formatCurrency(listing.price, listing.currency)}
              </span>
              <span className="pb-1 text-sm text-muted-foreground">
                {listing.isFreeShipping
                  ? "Free shipping"
                  : `+ ${formatCurrency(listing.shippingPrice ?? 0, listing.currency)} shipping`}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Estimated total{" "}
              <span className="font-semibold text-foreground">
                {formatCurrency(listing.totalPrice, listing.currency)}
              </span>
            </p>

            {unavailable && (
              <p
                role="status"
                className="mt-4 rounded-md border border-border bg-secondary/60 px-3.5 py-2.5 text-sm text-muted-foreground"
              >
                This listing is no longer available.
              </p>
            )}

            {/* Spec grid */}
            {detailsLoading && (
              <p className="mt-4 text-xs text-muted-foreground" aria-live="polite">
                Loading verified details…
              </p>
            )}
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-5 text-sm">
              {trustSignals(listing).length > 0 && (
                <Spec
                  label="Trust"
                  value={trustSignals(listing)
                    .map((s) => s.tooltip)
                    .join(" · ")}
                />
              )}
              <Spec label="Size" value={listing.size} />
              <Spec label="Condition" value={listing.condition} />
              <Spec label="Category" value={listing.category} />
              <Spec label="Color" value={listing.color} />
              <Spec label="Gender" value={listing.gender} />
              <Spec
                label="Listed"
                value={
                  listing.listedAt
                    ? new Date(listing.listedAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : undefined
                }
              />
            </dl>
            {/* Provenance: the seller's original size string, when the clean
                display differs from it. Secondary info only — the main size
                line always shows the normalized value. */}
            {verifiedSize?.rawValue && (
              <p className="mt-2 text-xs text-muted-foreground/80">
                Seller-listed size: {verifiedSize.rawValue}
              </p>
            )}

            {/* Seller */}
            <div className="mt-5 flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/50 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {listing.sellerName ?? "Marketplace seller"}
                  {listing.sellerVerified && (
                    <span className="ml-2 rounded-full bg-foreground px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-background">
                      Verified
                    </span>
                  )}
                </p>
                {listing.location && (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {listing.location}
                  </p>
                )}
              </div>
              <SellerRating rating={listing.sellerRating} />
            </div>

            {listing.description && (
              <div className="mt-5">
                <h3 className="eyebrow mb-2">Description</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {listing.description}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="mt-auto flex flex-col gap-2 pt-6">
              {unavailable ? (
                <Button size="lg" className="w-full" disabled>
                  Listing no longer available
                </Button>
              ) : (
                <Button asChild size="lg" className="w-full">
                  <a href={listing.listingUrl} target="_blank" rel="noopener noreferrer">
                    View original listing
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                </Button>
              )}
              <div className="flex gap-2">
                <div className="flex-1">
                  <CompareToggle listing={listing} variant="full" className="w-full" />
                </div>
                <FavoriteWide listing={listing} />
              </div>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Spec({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{value ?? "—"}</dd>
    </div>
  );
}

function FavoriteWide({ listing }: { listing: EnrichedListing }) {
  return (
    <div className="flex items-center">
      <FavoriteButton listing={listing} />
    </div>
  );
}
