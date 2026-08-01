import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  SavedSearchService,
  UnauthorizedError,
} from "@/lib/saved-searches/service";
import {
  noopNotificationScheduler,
  NOTIFICATION_TYPES,
} from "@/lib/saved-searches/notification-scheduler";

/**
 * A single saved search.
 *
 *   PATCH  /api/saved-searches/:id   → rename, toggle alerts
 *   DELETE /api/saved-searches/:id   → remove
 *
 * Ownership is never checked against a client-supplied id alone: the service
 * requires an authenticated session and RLS scopes the row to that user, so a
 * request for someone else's id simply finds nothing (404, not 403 — which
 * also avoids confirming that the id exists).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unconfigured = () =>
  NextResponse.json(
    { error: "Accounts are not configured in this deployment." },
    { status: 503 },
  );
const unauthorized = () =>
  NextResponse.json({ error: "Sign in to manage saved searches." }, { status: 401 });
const notFound = () =>
  NextResponse.json({ error: "Saved search not found." }, { status: 404 });

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const client = getSupabaseServerClient();
  if (!client) return unconfigured();

  let body: {
    name?: string;
    notificationsEnabled?: boolean;
    notificationTypes?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch: Parameters<SavedSearchService["update"]>[1] = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
    patch.name = name.slice(0, 120);
  }
  if (typeof body.notificationsEnabled === "boolean") {
    patch.notificationsEnabled = body.notificationsEnabled;
  }
  if (Array.isArray(body.notificationTypes)) {
    patch.notificationTypes = body.notificationTypes.filter(
      (t): t is (typeof NOTIFICATION_TYPES)[number] =>
        (NOTIFICATION_TYPES as readonly string[]).includes(t),
    );
  }

  try {
    const service = new SavedSearchService(client);
    const record = await service.update(params.id, patch);
    if (!record) return notFound();
    // Keep the (future) scheduler in step with the stored preference.
    if (patch.notificationsEnabled !== undefined) {
      await (record.notificationsEnabled
        ? noopNotificationScheduler.scheduleSavedSearch(record.id)
        : noopNotificationScheduler.unscheduleSavedSearch(record.id));
    }
    return NextResponse.json({ savedSearch: record });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ error: "Could not update the search." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const client = getSupabaseServerClient();
  if (!client) return unconfigured();
  try {
    const deleted = await new SavedSearchService(client).delete(params.id);
    if (!deleted) return notFound();
    await noopNotificationScheduler.unscheduleSavedSearch(params.id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ error: "Could not delete the search." }, { status: 500 });
  }
}
