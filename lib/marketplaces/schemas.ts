import { z } from "zod";

/**
 * Zod schemas describing the EXPECTED shape of an approved partner feed for
 * each marketplace. External data is untrusted — every live response is parsed
 * through these before mapping, so a malformed payload throws a clean error
 * (reported per-marketplace) instead of silently corrupting results.
 *
 * These shapes are modelled on the marketplaces' own object structures. When
 * you connect a real feed/aggregator whose fields differ, adjust the schema +
 * the matching `map…()` function together — nothing else needs to change.
 */


/* ────────────────────────────── eBay ──────────────────────────────
 * Shapes from the official Buy Browse API `item_summary/search` response.
 * https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
 */
const ebayAmountSchema = z.object({
  value: z.coerce.number(),
  currency: z.string().default("USD"),
});

export const ebayItemSummarySchema = z
  .object({
    itemId: z.string(),
    legacyItemId: z.string().nullish(),
    title: z.string(),
    shortDescription: z.string().nullish(),
    condition: z.string().nullish(),
    conditionId: z.string().nullish(),
    price: ebayAmountSchema.nullish(),
    image: z.object({ imageUrl: z.string() }).nullish(),
    thumbnailImages: z.array(z.object({ imageUrl: z.string() })).nullish(),
    additionalImages: z.array(z.object({ imageUrl: z.string() })).nullish(),
    itemWebUrl: z.string().nullish(),
    itemHref: z.string().nullish(),
    categories: z
      .array(z.object({ categoryId: z.string().nullish(), categoryName: z.string().nullish() }))
      .nullish(),
    shippingOptions: z
      .array(
        z.object({
          shippingCost: ebayAmountSchema.nullish(),
          shippingCostType: z.string().nullish(),
        }),
      )
      .nullish(),
    seller: z
      .object({
        username: z.string().nullish(),
        feedbackPercentage: z.coerce.number().nullish(),
        feedbackScore: z.coerce.number().nullish(),
      })
      .nullish(),
    itemLocation: z
      .object({
        country: z.string().nullish(),
        city: z.string().nullish(),
        stateOrProvince: z.string().nullish(),
      })
      .nullish(),
    itemCreationDate: z.string().nullish(),
    buyingOptions: z.array(z.string()).nullish(),
    /** Leaf category ids — tallied to find the dominant LEAF for aspect discovery. */
    leafCategoryIds: z.array(z.string()).nullish(),
    /** Official program coverage, e.g. ["AUTHENTICITY_GUARANTEE"]. Present when
     *  the request carries a delivery context (deliveryCountry/PostalCode). */
    qualifiedPrograms: z.array(z.string()).nullish(),
    /** eBay's official Top Rated Seller / Top Rated Plus indicator. */
    topRatedBuyingExperience: z.boolean().nullish(),
  })
  .passthrough();

/**
 * `refinement` block returned when the search request includes
 * `fieldgroups=ASPECT_REFINEMENTS,...`. Aspect names/values are the exact
 * strings eBay's aspect_filter expects — never invented locally.
 */
export const ebayRefinementSchema = z
  .object({
    dominantCategoryId: z.string().nullish(),
    aspectDistributions: z
      .array(
        z.object({
          localizedAspectName: z.string(),
          aspectValueDistributions: z
            .array(
              z.object({
                localizedAspectValue: z.string(),
                matchCount: z.number().nullish(),
              }),
            )
            .default([]),
        }),
      )
      .nullish(),
  })
  .passthrough();

export const ebaySearchResponseSchema = z.object({
  itemSummaries: z.array(ebayItemSummarySchema).default([]),
  total: z.number().nullish(),
  limit: z.number().nullish(),
  offset: z.number().nullish(),
  next: z.string().nullish(),
  refinement: ebayRefinementSchema.nullish(),
});

/** getItem (item detail) response — only the fields Quick View / Compare need. */
export const ebayItemDetailSchema = z
  .object({
    itemId: z.string(),
    legacyItemId: z.string().nullish(),
    title: z.string(),
    shortDescription: z.string().nullish(),
    condition: z.string().nullish(),
    conditionId: z.string().nullish(),
    price: ebayAmountSchema.nullish(),
    image: z.object({ imageUrl: z.string() }).nullish(),
    additionalImages: z.array(z.object({ imageUrl: z.string() })).nullish(),
    itemWebUrl: z.string().nullish(),
    categoryPath: z.string().nullish(),
    brand: z.string().nullish(),
    color: z.string().nullish(),
    itemLocation: z
      .object({ country: z.string().nullish(), city: z.string().nullish() })
      .nullish(),
    itemCreationDate: z.string().nullish(),
    itemEndDate: z.string().nullish(),
    estimatedAvailabilities: z
      .array(
        z.object({ estimatedAvailabilityStatus: z.string().nullish() }).passthrough(),
      )
      .nullish(),
    material: z.string().nullish(),
    qualifiedPrograms: z.array(z.string()).nullish(),
    seller: z
      .object({
        username: z.string().nullish(),
        feedbackPercentage: z.coerce.number().nullish(),
        feedbackScore: z.coerce.number().nullish(),
      })
      .nullish(),
    shippingOptions: z
      .array(z.object({ shippingCost: ebayAmountSchema.nullish() }))
      .nullish(),
    /** Structured item aspects — the authoritative source of Size/Brand/Color. */
    localizedAspects: z
      .array(z.object({ name: z.string(), value: z.string() }))
      .nullish(),
  })
  .passthrough();

export type EbayItemSummary = z.infer<typeof ebayItemSummarySchema>;
export type EbayRefinement = z.infer<typeof ebayRefinementSchema>;
export type EbayItemDetail = z.infer<typeof ebayItemDetailSchema>;

export const ebayTokenSchema = z.object({
  access_token: z.string(),
  expires_in: z.coerce.number(),
  token_type: z.string().optional(),
});

/* ────────────────────────────── Grailed ────────────────────────────── */
export const grailedRawItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: z.string(),
    designer_names: z.array(z.string()).optional(),
    category_path: z.array(z.string()).optional(),
    size: z.string().optional(),
    condition: z.string().optional(),
    color: z.string().optional(),
    price: z.coerce.number(),
    shipping: z.object({ us: z.coerce.number() }).nullish(),
    currency: z.string().default("USD"),
    photos: z.array(z.object({ url: z.string().url() })).default([]),
    seller: z
      .object({
        username: z.string().optional(),
        seller_score: z.coerce.number().optional(),
        badges: z.array(z.string()).optional(),
      })
      .nullish(),
    location: z.string().optional(),
    created_at: z.string().optional(),
    department: z.string().optional(), // "menswear" | "womenswear" -> gender
    description: z.string().optional(),
  })
  .passthrough();

const facetBucketSchema = z.object({
  value: z.string(),
  count: z.coerce.number(),
  /** Parent group from the source's own hierarchy — must not be stripped. */
  group: z.string().optional(),
});

export const grailedFeedSchema = z.object({
  listings: z.array(grailedRawItemSchema).default([]),
  total: z.number().nullish(),
  page: z.number().nullish(),
  /** Source's true page count (Algolia nbPages) — drives honest hasMore. */
  nbPages: z.number().nullish(),
  /**
   * Facet counts for the ENTIRE matching result set, not just the returned
   * page. This is what lets a broad search offer every real size/brand/category
   * instead of only what happened to land on page one.
   */
  facets: z
    .object({
      sizes: z.array(facetBucketSchema).optional(),
      categories: z.array(facetBucketSchema).optional(),
      brands: z.array(facetBucketSchema).optional(),
      conditions: z.array(facetBucketSchema).optional(),
      genders: z.array(facetBucketSchema).optional(),
      locations: z.array(facetBucketSchema).optional(),
      colors: z.array(facetBucketSchema).optional(),
      priceRange: z.object({ min: z.number(), max: z.number() }).optional(),
    })
    .nullish(),
});

export type GrailedRawItem = z.infer<typeof grailedRawItemSchema>;
export type GrailedFeed = z.infer<typeof grailedFeedSchema>;
