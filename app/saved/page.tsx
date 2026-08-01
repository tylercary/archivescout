import type { Metadata } from "next";
import { SavedItems } from "@/components/saved/saved-items";

// Private user page — keep out of search indexes.
export const metadata: Metadata = {
  title: "Saved items",
  robots: { index: false, follow: false },
};

export default function SavedPage() {
  return <SavedItems />;
}
