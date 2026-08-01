import Link from "next/link";
import { Logo } from "./logo";
import { MARKETPLACE_LABELS, MARKETPLACES } from "@/lib/marketplaces/types";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="container grid gap-10 py-14 md:grid-cols-[1.5fr_1fr_1fr]">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            One search across every resale marketplace. Find, compare, and track
            the pieces you actually want — from streetwear grails to vintage
            denim.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Demo experience using mock listing data. Live marketplace results
            require approved API access.
          </p>
        </div>

        <nav aria-label="Explore" className="text-sm">
          <h3 className="eyebrow mb-4">Explore</h3>
          <ul className="space-y-2.5">
            <li>
              <Link href="/search" className="text-muted-foreground hover:text-foreground">
                Search
              </Link>
            </li>
            <li>
              <Link href="/saved" className="text-muted-foreground hover:text-foreground">
                Saved items
              </Link>
            </li>
            <li>
              <Link href="/searches" className="text-muted-foreground hover:text-foreground">
                Saved searches
              </Link>
            </li>
            <li>
              <Link href="/compare" className="text-muted-foreground hover:text-foreground">
                Compare
              </Link>
            </li>
          </ul>
        </nav>

        <div className="text-sm">
          <h3 className="eyebrow mb-4">Marketplaces</h3>
          <ul className="space-y-2.5">
            {MARKETPLACES.map((m) => (
              <li key={m}>
                <Link
                  href={`/search?markets=${m}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {MARKETPLACE_LABELS[m]}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="container flex flex-col items-center justify-between gap-2 py-6 text-xs text-muted-foreground sm:flex-row">
          <p>© {2026} ArchiveScout. Not affiliated with any marketplace.</p>
          <p>Built for demonstration — respects marketplace Terms of Service.</p>
        </div>
      </div>
    </footer>
  );
}
