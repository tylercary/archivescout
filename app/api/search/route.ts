import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { runSearch } from "@/lib/search/engine";
import { parseSearchParams } from "@/lib/search/params";

// Server-only route. Marketplace credentials (read via the providers) never
// leave this boundary.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = parseSearchParams(request.nextUrl.searchParams);
    const result = await runSearch(params);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid search parameters", issues: error.flatten() },
        { status: 400 },
      );
    }
    console.error("[/api/search] error", error);
    return NextResponse.json(
      { error: "Search failed. Please try again." },
      { status: 500 },
    );
  }
}
