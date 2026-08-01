import type { Marketplace } from "./types";

/**
 * Resolves where a provider gets its data, chosen by DATA_SOURCE:
 *
 *   mock (default) — local mock listings, no network. Lets the app run with
 *                    zero configuration and backs any marketplace whose live
 *                    credentials are missing.
 *   live           — a real feed via that marketplace's *_API_BASE / *_API_KEY;
 *                    falls back to mock when either is absent.
 */
export type SourceMode = "mock" | "live";

export interface FeedConfig {
  mode: SourceMode;
  /** Absolute base URL of the feed's search endpoint (live mode only). */
  baseUrl?: string;
  apiKey?: string;
}

const DATA_SOURCE = (process.env.DATA_SOURCE ?? "mock").toLowerCase();

export function resolveFeed(
  _marketplace: Marketplace,
  envBase: string | undefined,
  envKey: string | undefined,
): FeedConfig {
  if (DATA_SOURCE === "live" && envBase && envKey) {
    return { mode: "live", baseUrl: envBase, apiKey: envKey };
  }
  return { mode: "mock" };
}
