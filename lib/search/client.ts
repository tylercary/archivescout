import type { SearchParams, SearchResponse } from "@/lib/marketplaces/types";
import { toQueryString } from "./params";

/** Fetch search results from the API route. Used by client components. */
export async function fetchSearch(
  params: SearchParams,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const qs = toQueryString({ ...params, page: params.page });
  const res = await fetch(`/api/search?${qs}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    let message = `Search failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await res.json()) as SearchResponse;
}
