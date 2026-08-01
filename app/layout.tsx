import type { Metadata } from "next";
import "./globals.css";
import { AppProviders } from "@/lib/store/providers";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { CompareDrawer } from "@/components/listings/compare-drawer";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://archivescout.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "ArchiveScout — Search every resale marketplace at once",
    template: "%s · ArchiveScout",
  },
  description:
    "Search and compare fashion listings from eBay, Grailed and more — all in one place. Find grails, filter results, save items, and track prices.",
  keywords: [
    "fashion resale",
    "grailed",
    "ebay fashion",
    "streetwear",
    "vintage",
    "sneakers",
    "archive fashion",
  ],
  applicationName: "ArchiveScout",
  openGraph: {
    type: "website",
    siteName: "ArchiveScout",
    title: "ArchiveScout — Search every resale marketplace at once",
    description:
      "One search across eBay and Grailed. Find and compare fashion listings, save items, and track prices.",
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "ArchiveScout — Search every resale marketplace at once",
    description:
      "One search across eBay and Grailed. Find and compare fashion listings.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <AppProviders>
          <div className="flex min-h-screen flex-col">
            <Navbar />
            <main id="main" className="flex-1">
              {children}
            </main>
            <Footer />
          </div>
          <CompareDrawer />
        </AppProviders>
      </body>
    </html>
  );
}
