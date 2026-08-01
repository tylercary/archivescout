import { MARKETPLACE_LABELS, type Marketplace } from "@/lib/marketplaces/types";
import { cn } from "@/lib/utils";

/**
 * A subtle wordmark badge per marketplace. We deliberately DO NOT reproduce
 * official brand logos (trademark/ToS); instead each marketplace gets a small,
 * distinct tonal chip that reads clearly against product imagery.
 */
const styles: Record<Marketplace, string> = {
  ebay: "bg-[#f5f5f0] text-[#111] ring-1 ring-black/5",
  grailed: "bg-white text-[#111] ring-1 ring-black/10",
};

const dot: Record<Marketplace, string> = {
  ebay: "bg-[#0064d2]",
  grailed: "bg-[#111]",
};

/** Compact wordmarks so long names don't overflow a card badge. */
const badgeLabel: Partial<Record<Marketplace, string>> = {};

export function MarketplaceBadge({
  marketplace,
  className,
  showDot = true,
}: {
  marketplace: Marketplace;
  className?: string;
  showDot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] shadow-sm",
        styles[marketplace],
        className,
      )}
    >
      {showDot && (
        <span className={cn("h-1.5 w-1.5 rounded-full", dot[marketplace])} />
      )}
      {badgeLabel[marketplace] ?? MARKETPLACE_LABELS[marketplace]}
    </span>
  );
}
