import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    { error: "This integration has been retired. No sync was performed." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
