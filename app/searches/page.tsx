import type { Metadata } from "next";
import { SavedSearchesDashboard } from "@/components/searches/saved-searches";

export const metadata: Metadata = {
  title: "Saved searches",
  robots: { index: false, follow: false },
};

export default function SearchesPage() {
  return <SavedSearchesDashboard />;
}
