import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function configuredSenderDomain() {
  const from = process.env.RESERVATION_EMAIL_FROM?.trim() ?? "";
  const match = from.match(/@([^>\s]+)>?$/);
  return match?.[1]?.toLowerCase() ?? null;
}

export async function GET() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const domainName = configuredSenderDomain();
  if (!apiKey || !domainName)
    return NextResponse.json(
      { state: "not_configured" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );

  try {
    const response = await fetch("https://api.resend.com/domains", {
      headers: { authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("resend_unavailable");
    const body = (await response.json()) as {
      data?: Array<{ name?: unknown; status?: unknown }>;
    };
    const domain = body.data?.find(
      (item) => item.name === domainName,
    );
    const state = domain?.status === "verified" ? "ready" : "pending";
    return NextResponse.json(
      { state },
      {
        status: state === "ready" ? 200 : 503,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      { state: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
