import { EbayProvider } from "./ebay";
import { GrailedProvider } from "./grailed";
import type { Marketplace, MarketplaceProvider } from "./types";

/**
 * Server-side registry mapping each marketplace to its provider instance.
 * Constructed once per server runtime. Import ONLY from server code
 * (API routes / server components) so credentials never reach the browser.
 */
const providers: Record<Marketplace, MarketplaceProvider> = {
  ebay: new EbayProvider(),
  grailed: new GrailedProvider(),
};

export function getProvider(marketplace: Marketplace): MarketplaceProvider {
  return providers[marketplace];
}

export function getProviders(marketplaces: Marketplace[]): MarketplaceProvider[] {
  return marketplaces.map(getProvider);
}
