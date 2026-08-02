import type { AlertEventType } from "./alert-detection";

/**
 * Alert delivery, behind an interface so the sweep never knows which provider
 * (or none) is in play. Email first; push/SMS would implement the same shape.
 */

export interface AlertEmailListing {
  title: string;
  marketplace: string;
  imageUrl?: string;
  listingUrl: string;
  currency: string;
  price: number;
  previousPrice?: number;
  eventType: AlertEventType;
}

export interface AlertEmailSection {
  savedSearchName: string;
  /** Deep link back into ArchiveScout with the saved search restored. */
  searchUrl: string;
  listings: AlertEmailListing[];
}

export interface SavedSearchAlertEmail {
  to: string;
  /** One digest per user per sweep — never one email per listing. */
  sections: AlertEmailSection[];
  newCount: number;
  dropCount: number;
}

export interface AlertDeliveryProvider {
  sendSavedSearchAlert(input: SavedSearchAlertEmail): Promise<void>;
}

/* ─────────────────────────── formatting ─────────────────────────── */

const money = (v: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(v);

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** Digest subject: says what happened without opening it. */
export function alertSubject(input: SavedSearchAlertEmail): string {
  const bits: string[] = [];
  if (input.newCount) bits.push(`${input.newCount} new`);
  if (input.dropCount) bits.push(`${input.dropCount} price drop${input.dropCount === 1 ? "" : "s"}`);
  const summary = bits.join(" · ") || "updates";
  const first = input.sections[0]?.savedSearchName ?? "your saved searches";
  return input.sections.length === 1
    ? `${summary} — ${first}`
    : `${summary} across ${input.sections.length} saved searches`;
}

/** Plain, inline-styled HTML — email clients ignore stylesheets. */
export function renderAlertEmail(input: SavedSearchAlertEmail): string {
  const rows = input.sections
    .map((section) => {
      const items = section.listings
        .map((l) => {
          const priceLine =
            l.eventType === "price_drop" && l.previousPrice != null
              ? `<span style="text-decoration:line-through;color:#888">${money(l.previousPrice, l.currency)}</span>
                 &nbsp;<strong>${money(l.price, l.currency)}</strong>`
              : `<strong>${money(l.price, l.currency)}</strong>`;
          const img = l.imageUrl
            ? `<img src="${escapeHtml(l.imageUrl)}" width="64" height="64" alt="" style="border-radius:6px;object-fit:cover;vertical-align:middle">`
            : "";
          return `<tr>
            <td style="padding:8px 10px 8px 0;width:64px">${img}</td>
            <td style="padding:8px 0;font:14px -apple-system,Segoe UI,sans-serif;color:#111">
              <a href="${escapeHtml(l.listingUrl)}" style="color:#111;text-decoration:none;font-weight:600">${escapeHtml(l.title)}</a><br>
              <span style="color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(l.marketplace)}</span>
              &nbsp;·&nbsp;${priceLine}
            </td>
          </tr>`;
        })
        .join("");
      return `<h2 style="font:600 16px -apple-system,Segoe UI,sans-serif;color:#111;margin:28px 0 4px">
                ${escapeHtml(section.savedSearchName)}
              </h2>
              <a href="${escapeHtml(section.searchUrl)}" style="font:13px -apple-system,Segoe UI,sans-serif;color:#555">View this search →</a>
              <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin-top:8px">${items}</table>`;
    })
    .join("");

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#fafaf9">
    <div style="max-width:560px;margin:0 auto">
      <p style="font:600 18px -apple-system,Segoe UI,sans-serif;color:#111;margin:0 0 4px">ArchiveScout</p>
      <p style="font:14px -apple-system,Segoe UI,sans-serif;color:#555;margin:0">${escapeHtml(alertSubject(input))}</p>
      ${rows}
      <p style="font:12px -apple-system,Segoe UI,sans-serif;color:#888;margin-top:32px;border-top:1px solid #e5e5e5;padding-top:12px">
        You're receiving this because you enabled alerts on a saved search.
        Manage them in ArchiveScout under Saved searches.
      </p>
    </div>
  </body></html>`;
}

/* ─────────────────────────── providers ─────────────────────────── */

/** Resend. Chosen for a plain HTTP API — no SDK dependency needed. */
export class ResendDeliveryProvider implements AlertDeliveryProvider {
  // Explicit fields rather than constructor parameter properties: Node's
  // type-stripping (used by the unit tests) can't compile those.
  private readonly apiKey: string;
  private readonly from: string;

  constructor(apiKey: string, from: string) {
    this.apiKey = apiKey;
    this.from = from;
  }

  async sendSavedSearchAlert(input: SavedSearchAlertEmail): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [input.to],
        subject: alertSubject(input),
        html: renderAlertEmail(input),
      }),
    });
    if (!res.ok) {
      // Body may echo request detail; status alone is safe to surface.
      throw new Error(`Resend responded ${res.status}`);
    }
  }
}

/** Used when alerts are enabled but no provider is configured, and in tests. */
export class NoopDeliveryProvider implements AlertDeliveryProvider {
  readonly sent: SavedSearchAlertEmail[] = [];
  async sendSavedSearchAlert(input: SavedSearchAlertEmail): Promise<void> {
    this.sent.push(input);
  }
}
