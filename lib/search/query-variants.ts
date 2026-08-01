/**
 * Conservative query normalization.
 *
 * Marketplaces tokenize differently — Grailed's Algolia does not stem, so
 * "chanel running" finds nothing while "chanel runner" has hits. Rather than
 * rewriting the user's query (their text stays visible and canonical), the
 * engine searches a SMALL set of safe variants and merges, deduplicating by
 * listing id (marketplace + externalId).
 *
 * Rules are deliberately narrow: a short table of generic fashion terms,
 * one-token substitutions only, never brand names, capped at
 * MAX_QUERY_VARIANTS total requests per marketplace.
 */

/** Total variants searched per query, INCLUDING the original. */
export const MAX_QUERY_VARIANTS = 3;

/**
 * token → alternates, tried in order. Only generic garment vocabulary —
 * brand tokens never appear here, so brands are structurally safe.
 */
const TOKEN_VARIANTS: Record<string, string[]> = {
  running: ["runner", "runners"],
  runners: ["runner", "running"],
  runner: ["runners", "running"],
  trainers: ["sneakers", "sneaker"],
  trainer: ["sneaker"],
  sneakers: ["sneaker", "trainers"],
  sneaker: ["sneakers"],
  tshirt: ["t-shirt"],
  tshirts: ["t-shirts"],
  "t-shirt": ["tshirt"],
  jeans: ["denim"],
};

/**
 * Whole-phrase canonicalizations applied inside variants (not to the shown
 * query): compact/hyphenated forms of multi-word terms.
 */
const PHRASE_VARIANTS: [RegExp, string][] = [
  [/\bdouble[-\s]?knees\b/gi, "double knee"],
  [/\bdoubleknees?\b/gi, "double knee"],
  [/\bdouble-knee\b/gi, "double knee"],
];

/**
 * Expand a query into itself plus up to MAX_QUERY_VARIANTS-1 safe variants.
 * The original query is always first (it stays the canonical one for ranking
 * and display). Queries with no matching vocabulary return just [query].
 */
export function expandQueryVariants(query: string): string[] {
  const original = query.trim();
  if (!original) return [original];

  const variants: string[] = [original];
  const push = (candidate: string) => {
    const v = candidate.trim().replace(/\s+/g, " ");
    if (v && !variants.some((x) => x.toLowerCase() === v.toLowerCase())) {
      variants.push(v);
    }
  };

  // Phrase canonicalizations first — they fix forms marketplaces won't match.
  for (const [pattern, replacement] of PHRASE_VARIANTS) {
    if (variants.length >= MAX_QUERY_VARIANTS) break;
    pattern.lastIndex = 0;
    if (pattern.test(original)) push(original.replace(pattern, replacement));
  }

  // One-token substitutions: the FIRST token with alternates is expanded —
  // multi-token cross products would explode the request count.
  const tokens = original.split(/\s+/);
  outer: for (let i = 0; i < tokens.length; i += 1) {
    const alts = TOKEN_VARIANTS[tokens[i].toLowerCase()];
    if (!alts) continue;
    for (const alt of alts) {
      if (variants.length >= MAX_QUERY_VARIANTS) break outer;
      push([...tokens.slice(0, i), alt, ...tokens.slice(i + 1)].join(" "));
    }
    break; // only the first variant-bearing token
  }

  return variants.slice(0, MAX_QUERY_VARIANTS);
}
