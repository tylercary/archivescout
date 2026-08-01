import type { Metadata } from "next";
import { CompareView } from "@/components/compare/compare-view";

export const metadata: Metadata = {
  title: "Compare listings",
  robots: { index: false, follow: false },
};

export default function ComparePage() {
  return <CompareView />;
}
