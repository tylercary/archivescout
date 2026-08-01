import Link from "next/link";
import { ArrowUpRight, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { SearchBar } from "@/components/search/search-bar";
import { TrendingSearches } from "@/components/search/trending-searches";
import { ListingGrid } from "@/components/listings/listing-grid";
import {
  MARKETPLACE_LABELS,
  MARKETPLACES,
  type EnrichedListing,
} from "@/lib/marketplaces/types";
import { getFeaturedListings } from "@/lib/listings";
import { runSearch } from "@/lib/search/engine";

// Fetch featured listings live at request time (so live-mode shows real data).
export const dynamic = "force-dynamic";

/** Curated queries that surface strong featured inventory. */
const FEATURED_QUERIES = [
  "chanel runner",
  "carhartt double knee",
  "balenciaga sneaker",
  "maison margiela gat",
];

/** Only feature listings that are complete and real. */
function isFeaturable(l: EnrichedListing): boolean {
  return (
    l.marketplace === "grailed" &&
    Boolean(l.externalId) &&
    Boolean(l.title?.trim()) &&
    typeof l.price === "number" &&
    Number.isFinite(l.price) &&
    l.price > 0 &&
    Boolean(l.listingUrl?.startsWith("https://")) &&
    Boolean(l.imageUrls[0]?.startsWith("https://"))
  );
}

/**
 * LIVE featured grid: several curated queries through the same live Grailed
 * provider + normalized mapper the search page uses. Each card's image, title,
 * price, and URL all come from ONE normalized Listing. Returns [] when live
 * inventory is unavailable — the page then shows an "unavailable" state, and
 * NEVER silently swaps in mock cards.
 */
async function getLiveFeatured(limit: number): Promise<EnrichedListing[]> {
  const settled = await Promise.allSettled(
    FEATURED_QUERIES.map((query) =>
      runSearch({
        query,
        marketplaces: ["grailed"],
        filters: {},
        sort: "recommended",
        page: 1,
        perPage: 6,
      }),
    ),
  );

  const buckets = settled
    .filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof runSearch>>> =>
        r.status === "fulfilled",
    )
    .map((r) => r.value.listings.filter(isFeaturable));

  // Round-robin across queries, dedupe by `${marketplace}:${externalId}` (id).
  const out: EnrichedListing[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < limit; i += 1) {
    let added = false;
    for (const bucket of buckets) {
      const item = bucket[i];
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
        added = true;
        if (out.length >= limit) break;
      }
    }
    if (!added) break;
  }
  return out;
}

export default async function HomePage() {
  // Mock fallback is ONLY for explicit mock mode; live/sandbox never mixes in
  // mock featured cards.
  const dataSource = (process.env.DATA_SOURCE ?? "mock").toLowerCase();
  const useLive = dataSource === "live" || dataSource === "sandbox";
  const featured = useLive ? await getLiveFeatured(8) : getFeaturedListings(8);

  return (
    <div className="animate-fade-in">
      {/* ───────────────────────── Hero ───────────────────────── */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,hsl(40_14%_94%),transparent)]" />
        <div className="container relative py-20 sm:py-28 lg:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <p className="eyebrow mb-5 inline-flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5" />
              {MARKETPLACES.map((m) => MARKETPLACE_LABELS[m]).join(" · ")} · and more
            </p>
            <h1 className="text-balance font-display text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              Search every resale
              <br className="hidden sm:block" /> marketplace at once.
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
              ArchiveScout brings eBay and Grailed into a single search.
              Find the exact piece you want, compare listings side by side, and
              open the original the moment you spot a deal.
            </p>

            <div className="mx-auto mt-9 max-w-2xl">
              <SearchBar size="hero" autoFocus />
            </div>

            <TrendingSearches className="mt-7" />
          </div>
        </div>
      </section>

      {/* ─────────────────────── Value props ─────────────────────── */}
      <section className="border-b border-border bg-secondary/40">
        <div className="container grid gap-8 py-10 sm:grid-cols-3">
          <ValueProp
            icon={<Zap className="h-5 w-5" />}
            title="One search, every source"
            body="Query eBay and Grailed together and get a single, merged feed of results."
          />
          <ValueProp
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Compare before you commit"
            body="Line up to four listings side by side — price, shipping, condition, and seller."
          />
          <ValueProp
            icon={<Sparkles className="h-5 w-5" />}
            title="Never miss a grail"
            body="Save searches and favorites, and flag price alerts on the pieces you're hunting."
          />
        </div>
      </section>

      {/* ─────────────────────── Featured grid ─────────────────────── */}
      <section className="container py-16 sm:py-20">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Curated right now</p>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              Featured listings
            </h2>
          </div>
          <Link
            href="/search"
            className="group inline-flex items-center gap-1 text-sm font-medium text-foreground"
          >
            Browse all
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>

        {featured.length > 0 ? (
          <ListingGrid listings={featured} priorityCount={4} />
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/30 px-6 py-16 text-center">
            <p className="font-display text-xl font-semibold tracking-tight">
              Featured listings are unavailable right now
            </p>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              We couldn&apos;t load live inventory. Try a search instead — or
              check back shortly.
            </p>
            <Link
              href="/search"
              className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Start searching
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

function ValueProp({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm">
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
