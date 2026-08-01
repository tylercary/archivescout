/**
 * Validation for post-auth redirect destinations.
 *
 * A `next` parameter is attacker-controllable: it arrives in a URL that can be
 * emailed or linked. If it were used unchecked, an attacker could send
 * `/signin?next=https://evil.example` and land a freshly-authenticated user on
 * their page — an open redirect, and a credible phishing primitive.
 *
 * Only same-origin, single-slash, absolute PATHS are accepted. Everything else
 * falls back to a safe default.
 */

export const DEFAULT_NEXT = "/";

/** Control characters that could smuggle a header/URL break. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
/** "/https:" , "//evil" style scheme smuggling after leading slashes. */
const SCHEME_AFTER_SLASHES = /^\/+[a-z][a-z0-9+.-]*:/i;

export function safeNext(
  value: string | null | undefined,
  fallback: string = DEFAULT_NEXT,
): string {
  if (!value) return fallback;

  let candidate = value.trim();
  if (!candidate) return fallback;

  // Tolerate one layer of encoding (query strings often arrive encoded).
  if (/^%2f/i.test(candidate)) {
    try {
      candidate = decodeURIComponent(candidate);
    } catch {
      return fallback;
    }
  }

  if (CONTROL_CHARS.test(candidate)) return fallback;
  // Must be an absolute path…
  if (!candidate.startsWith("/")) return fallback;
  // …but NOT protocol-relative ("//evil.example" is absolute to a browser),
  // and not a backslash variant that some parsers normalize to "//".
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
  if (SCHEME_AFTER_SLASHES.test(candidate)) return fallback;

  return candidate;
}
