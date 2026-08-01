import { createHash } from "node:crypto";

/**
 * eBay Marketplace Account Deletion / Closure notification support.
 *
 * eBay requires every application with Production keys to expose a public
 * endpoint that (a) answers a one-time GET verification challenge and (b)
 * accepts POSTed account-deletion notifications. This module holds the pure
 * logic so the route handler stays thin and the behaviour is unit-testable.
 *
 * ── Data handling ───────────────────────────────────────────────────────────
 * ArchiveScout stores NO eBay member personal data. eBay listings are fetched
 * live per request from the Browse API and never persisted; the only stored
 * data is the visitor's own local-storage state (favourites, compare, recent
 * searches), which is keyed to their browser and contains no eBay member
 * identifiers. There is therefore currently no user-data deletion to perform —
 * acknowledging the notification is the complete and correct action.
 *
 * If ArchiveScout ever begins storing eBay user information, implement the
 * erasure inside `handleAccountDeletion` below; the route already parses,
 * validates and acknowledges the notification around it.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Env var names, in the exact order eBay requires them to be concatenated. */
export const VERIFICATION_TOKEN_ENV = "EBAY_DELETION_VERIFICATION_TOKEN";
export const ENDPOINT_ENV = "EBAY_DELETION_ENDPOINT";

/** eBay's constraints on the verification token. */
export const TOKEN_MIN_LENGTH = 32;
export const TOKEN_MAX_LENGTH = 80;

export type DeletionConfig =
  | { ok: true; verificationToken: string; endpoint: string }
  | { ok: false; problems: string[] };

/**
 * Resolve + validate the endpoint's configuration from the environment.
 *
 * Returns problem descriptions naming only the ENV VARS — never their values —
 * so the result is safe to write to a server log.
 */
export function resolveDeletionConfig(
  env: NodeJS.ProcessEnv = process.env,
): DeletionConfig {
  const verificationToken = env[VERIFICATION_TOKEN_ENV]?.trim();
  const endpoint = env[ENDPOINT_ENV]?.trim();
  const problems: string[] = [];

  if (!verificationToken) {
    problems.push(`${VERIFICATION_TOKEN_ENV} is not set`);
  } else if (
    verificationToken.length < TOKEN_MIN_LENGTH ||
    verificationToken.length > TOKEN_MAX_LENGTH
  ) {
    problems.push(
      `${VERIFICATION_TOKEN_ENV} must be ${TOKEN_MIN_LENGTH}-${TOKEN_MAX_LENGTH} characters ` +
        `(got ${verificationToken.length})`,
    );
  }

  if (!endpoint) {
    problems.push(`${ENDPOINT_ENV} is not set`);
  } else if (!endpoint.startsWith("https://")) {
    // eBay only calls HTTPS endpoints, and the hash must match the portal value
    // exactly — an http:// value here would verify locally and fail at eBay.
    problems.push(`${ENDPOINT_ENV} must be an https:// URL`);
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, verificationToken: verificationToken!, endpoint: endpoint! };
}

/**
 * eBay's challenge response:
 *
 *   SHA256(challengeCode + verificationToken + endpointUrl)  -> lowercase hex
 *
 * The order is fixed by eBay and the endpoint string must byte-for-byte match
 * the URL registered in the Developer Portal (scheme, host, path, casing, and
 * any trailing slash) — a mismatch produces a valid-looking hash that eBay
 * rejects.
 */
export function computeChallengeResponse(
  challengeCode: string,
  verificationToken: string,
  endpoint: string,
): string {
  return createHash("sha256")
    .update(challengeCode)
    .update(verificationToken)
    .update(endpoint)
    .digest("hex");
}

/** The non-sensitive envelope fields we are willing to log in development. */
export interface SafeNotificationMetadata {
  topic?: string;
  notificationId?: string;
  publishDate?: string;
  publishAttemptCount?: number;
}

/**
 * Pull ONLY non-identifying envelope fields out of a notification.
 *
 * eBay puts the member identifiers (`username`, `userId`, `eiasToken`) under
 * `notification.data`, which is deliberately never read here so it cannot be
 * logged by accident.
 */
export function safeMetadata(payload: unknown): SafeNotificationMetadata {
  if (typeof payload !== "object" || payload === null) return {};
  const root = payload as Record<string, unknown>;
  const metadata = (root.metadata ?? {}) as Record<string, unknown>;
  const notification = (root.notification ?? {}) as Record<string, unknown>;

  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);

  return {
    topic: str(metadata.topic),
    notificationId: str(notification.notificationId),
    publishDate: str(notification.publishDate),
    publishAttemptCount: num(notification.publishAttemptCount),
  };
}

/**
 * Perform whatever erasure a deletion notification requires.
 *
 * Currently a no-op by design: ArchiveScout persists no eBay member data (see
 * the module header). This is the single seam to fill in if that changes —
 * delete the member's rows here, keyed off the identifiers in
 * `notification.data`, and keep those identifiers out of logs.
 */
export async function handleAccountDeletion(
  _payload: unknown,
): Promise<{ actionTaken: "none" }> {
  return { actionTaken: "none" };
}
