/**
 * Minimal, dependency-free HTTP helper for live marketplace providers.
 * Adds request timeouts, bounded retries with backoff, and typed errors so
 * providers can surface clean failures the search engine can report per-source.
 *
 * Server-only — never import from client components.
 */

export class MarketplaceRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MarketplaceRequestError";
  }
}

export interface FetchJsonOptions {
  headers?: Record<string, string>;
  /** Abort the request after this many ms (default 8000). */
  timeoutMs?: number;
  /** Retry attempts on network error / 5xx / 429 (default 2). */
  retries?: number;
  /** Base backoff in ms; grows linearly per attempt (default 300). */
  backoffMs?: number;
  /** Next.js fetch cache hint. */
  revalidate?: number;
  signal?: AbortSignal;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Fetch JSON with timeout + retry. Throws `MarketplaceRequestError` on any
 * non-2xx response or network/timeout failure after exhausting retries.
 */
export async function fetchJson<T = unknown>(
  url: string | URL,
  options: FetchJsonOptions = {},
): Promise<T> {
  const {
    headers,
    timeoutMs = 8000,
    retries = 2,
    backoffMs = 300,
    revalidate,
    signal,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    // Link an external abort signal to our controller.
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener("abort", onExternalAbort, { once: true });

    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", ...headers },
        signal: controller.signal,
        ...(revalidate !== undefined ? { next: { revalidate } } : {}),
      });

      if (!res.ok) {
        if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
          lastError = new MarketplaceRequestError(
            `Upstream responded ${res.status}`,
            res.status,
          );
          await sleep(backoffMs * (attempt + 1), signal);
          continue;
        }
        // Drain body for a useful message but don't fail if it isn't text.
        const body = await res.text().catch(() => "");
        throw new MarketplaceRequestError(
          `Upstream responded ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
          res.status,
        );
      }

      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      // A caller-initiated abort should propagate immediately.
      if (isAbort && signal?.aborted) throw err;
      const retryable =
        attempt < retries &&
        (isAbort || err instanceof TypeError || err instanceof MarketplaceRequestError);
      if (!retryable) break;
      await sleep(backoffMs * (attempt + 1), signal);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onExternalAbort);
    }
  }

  if (lastError instanceof MarketplaceRequestError) throw lastError;
  throw new MarketplaceRequestError(
    lastError instanceof Error ? lastError.message : "Request failed",
    undefined,
    lastError,
  );
}
