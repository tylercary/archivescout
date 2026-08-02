/**
 * Whether saved-search alerts are actually operational.
 *
 * The UI must never imply an alert will be delivered when nothing can deliver
 * it. This is the single source of truth: it is TRUE only when the flag is on
 * AND every service the sweep depends on is configured. A missing service
 * silently degrades to "Coming soon" rather than to silent failure.
 *
 * Server-only pieces (service role, Resend key) can't be read in the browser,
 * so the resolved boolean is passed to the client via NEXT_PUBLIC_… — see
 * `alertsEnabledPublic()`.
 */

/** Requirements for the sweep to run end-to-end. */
export interface AlertsReadiness {
  enabled: boolean;
  flagOn: boolean;
  hasServiceRole: boolean;
  hasResendKey: boolean;
  hasFromEmail: boolean;
  hasCronSecret: boolean;
  /** Human-readable list of what's missing, for logs and the status view. */
  missing: string[];
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

/** SERVER-SIDE readiness. Never call from a client component. */
export function alertsReadiness(
  env: NodeJS.ProcessEnv = process.env,
): AlertsReadiness {
  const flagOn = truthy(env.SAVED_SEARCH_ALERTS_ENABLED);
  const hasServiceRole = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);
  const hasResendKey = Boolean(env.RESEND_API_KEY);
  const hasFromEmail = Boolean(env.ALERT_FROM_EMAIL);
  const hasCronSecret = Boolean(env.ALERT_CRON_SECRET);

  const missing: string[] = [];
  if (!flagOn) missing.push("SAVED_SEARCH_ALERTS_ENABLED");
  if (!hasServiceRole) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!hasResendKey) missing.push("RESEND_API_KEY");
  if (!hasFromEmail) missing.push("ALERT_FROM_EMAIL");
  if (!hasCronSecret) missing.push("ALERT_CRON_SECRET");

  return {
    enabled: missing.length === 0,
    flagOn,
    hasServiceRole,
    hasResendKey,
    hasFromEmail,
    hasCronSecret,
    missing,
  };
}

/**
 * CLIENT-SAFE view. Reads only the public mirror of the resolved flag, which
 * the deploy sets alongside the server vars. Defaults to false — the honest
 * answer when we can't confirm alerts work.
 */
export function alertsEnabledPublic(): boolean {
  return truthy(process.env.NEXT_PUBLIC_SAVED_SEARCH_ALERTS_ENABLED);
}
