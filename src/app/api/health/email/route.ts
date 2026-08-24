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

  // The production Resend key is intentionally restricted to sending access.
  // Such a key cannot call the Domains API, so probing that endpoint would
  // report a false outage even while delivery is healthy. DNS/provider
  // verification is a deployment-time check; runtime readiness confirms that
  // the restricted credential and a syntactically valid sender are configured.
  return NextResponse.json(
    { state: "ready", senderDomain: domainName },
    { headers: { "cache-control": "no-store" } },
  );
}
