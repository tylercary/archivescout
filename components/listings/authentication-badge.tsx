import { ShieldCheck, Star } from "lucide-react";
import type { Listing } from "@/lib/marketplaces/types";
import { cn } from "@/lib/utils";

/**
 * Subtle authentication indicator. Renders ONLY when the marketplace's
 * official program covers the listing (`listing.authenticated === true` from
 * verified source data) — never inferred, never from an active filter.
 *
 * Future marketplaces plug in here: add their label/tooltip/policy entry.
 */
const PRESENTATION: Record<
  string,
  { label: string; tooltip: string; policyUrl?: string }
> = {
  ebay: {
    label: "Authenticity Guarantee",
    tooltip: "Covered by eBay Authenticity Guarantee",
    policyUrl: "https://pages.ebay.com/authenticity-guarantee/",
  },
  grailed: {
    label: "Authenticated",
    tooltip: "Authenticated by Grailed",
    policyUrl: "https://help.grailed.com/hc/en-us/articles/360046662954",
  },
  therealreal: { label: "Authenticated", tooltip: "Authenticated by The RealReal" },
  vestiaire: { label: "Authenticated", tooltip: "Authenticated by Vestiaire Collective" },
};

export function authenticationPresentation(listing: Listing) {
  if (!listing.authenticated || !listing.authenticationSource) return null;
  return PRESENTATION[listing.authenticationSource] ?? null;
}

/** Every trust signal a listing genuinely carries, authentication first. */
export function trustSignals(listing: Listing): {
  key: string;
  label: string;
  tooltip: string;
  icon: "shield" | "star";
}[] {
  const out: { key: string; label: string; tooltip: string; icon: "shield" | "star" }[] = [];
  const auth = authenticationPresentation(listing);
  if (auth) {
    out.push({ key: "auth", label: auth.label, tooltip: auth.tooltip, icon: "shield" });
  }
  if (listing.sellerVerified) {
    out.push({
      key: "trusted",
      label: "Trusted Seller",
      tooltip:
        listing.marketplace === "ebay"
          ? "eBay Top Rated seller"
          : "Trusted Seller on Grailed",
      icon: "star",
    });
  }
  return out;
}

/**
 * Subtle trust badges. Renders only signals the listing genuinely carries,
 * capped at 2 so cards stay calm.
 */
export function AuthenticationBadge({
  listing,
  className,
  max = 2,
}: {
  listing: Listing;
  className?: string;
  max?: number;
}) {
  const signals = trustSignals(listing).slice(0, max);
  if (signals.length === 0) return null;
  return (
    <>
      {signals.map((s) => (
        <span
          key={s.key}
          title={s.tooltip}
          className={cn(
            "inline-flex items-center gap-1 text-[0.68rem] font-medium text-muted-foreground",
            className,
          )}
        >
          {s.icon === "shield" ? (
            <ShieldCheck className="h-3 w-3" aria-hidden />
          ) : (
            <Star className="h-3 w-3" aria-hidden />
          )}
          {s.label}
        </span>
      ))}
    </>
  );
}
