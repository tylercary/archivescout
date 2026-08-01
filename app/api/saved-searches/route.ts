import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  SavedSearchService,
  UnauthorizedError,
} from "@/lib/saved-searches/service";
import {
  defaultSearchName,
  toSavedSearchPayload,
} from "@/lib/saved-searches/serializer";
import { noopNotificationScheduler, NOTIFICATION_TYPES } from "@/lib/saved-searches/notification-scheduler";
import { parseSearchParams } from "@/lib/search/params";

/**
 * Saved searches collection.
 *
 *   GET  /api/saved-searches            → the signed-in user's searches
 *   POST /api/saved-searches            → save the current search
 *
 * Identity ALWAYS comes from the session (`auth.getUser()` inside the
 * service) — a `userId` in the request body is ignored. RLS enforces the same
 * boundary in the database as a second, independent layer.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unconfigured() {
  return NextResponse.json(
    { error: "Accounts are not configured in this deployment." },
    { status: 503 },
  );
}

function unauthorized() {
  return NextResponse.json({ error: "Sign in to save searches." }, { status: 401 });
}

export async function GET() {
  const client = getSupabaseServerClient();
  if (!client) return unconfigured();
  try {
    const records = await new SavedSearchService(client).list();
    return NextResponse.json({ savedSearches: records });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ error: "Could not load saved searches." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const client = getSupabaseServerClient();
  if (!client) return unconfigured();

  let body: {
    // The search to save, as its URL query string — the app's canonical,
    // marketplace-neutral representation. Never provider syntax.
    searchQueryString?: string;
    name?: string;
    notificationsEnabled?: boolean;
    notificationTypes?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.searchQueryString !== "string") {
    return NextResponse.json(
      { error: "searchQueryString is required." },
      { status: 400 },
    );
  }

  // Re-parse server-side: the client's string is untrusted input, and parsing
  // is what normalizes/validates it (unknown params are dropped).
  const params = parseSearchParams(new URLSearchParams(body.searchQueryString));
  const payload = toSavedSearchPayload(params);
  const types = (body.notificationTypes ?? []).filter((t): t is (typeof NOTIFICATION_TYPES)[number] =>
    (NOTIFICATION_TYPES as readonly string[]).includes(t),
  );

  try {
    const { record, duplicate } = await new SavedSearchService(client).create({
      payload,
      name: (body.name ?? "").trim() || defaultSearchName(payload),
      notificationsEnabled: Boolean(body.notificationsEnabled),
      notificationTypes: types,
    });
    if (record.notificationsEnabled) {
      await noopNotificationScheduler.scheduleSavedSearch(record.id);
    }
    // 200 (not 201) for a duplicate: nothing was created, the existing search
    // is returned so the UI can switch straight to its "Saved" state.
    return NextResponse.json({ savedSearch: record, duplicate }, {
      status: duplicate ? 200 : 201,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ error: "Could not save the search." }, { status: 500 });
  }
}
