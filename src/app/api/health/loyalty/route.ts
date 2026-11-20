import { appSurface } from "@/lib/app-surface";
import { churchLoyaltyReadiness } from "@/lib/integrations/church-square-loyalty.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const headers = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
  if (appSurface !== "operations") return new Response(null, { status: 404, headers });
  const program = await churchLoyaltyReadiness();
  return Response.json({
    status: program === "active" ? "ok" : "setup_needed",
    program,
    appleWallet: "requires_dashboard_and_device_verification",
  }, { status: program === "unavailable" ? 503 : 200, headers });
}
