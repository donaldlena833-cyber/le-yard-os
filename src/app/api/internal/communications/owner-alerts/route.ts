import { createHash, timingSafeEqual } from "node:crypto";
import {
  enqueueOwnerSmsSetup,
  ownerSmsAlertsEnabled,
  processOwnerSmsAlertQueue,
} from "@/lib/owner-sms-alerts.server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.OWNER_SMS_ALERTS_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization") ?? "";
  if (secret.length < 32 || supplied.length > 1024) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(supplied), digest(`Bearer ${secret}`));
}

function unavailable(request: Request) {
  if (!authorized(request)) return new Response("Forbidden", { status: 403 });
  if (!ownerSmsAlertsEnabled())
    return Response.json({ error: "Owner alerts are disabled." }, { status: 409 });
}

export async function GET(request: Request) {
  const denied = unavailable(request);
  if (denied) return denied;
  try {
    const result = await processOwnerSmsAlertQueue();
    return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Alert queue unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const denied = unavailable(request);
  if (denied) return denied;
  let input: unknown;
  try { input = JSON.parse((await request.text()).slice(0, 1024)); }
  catch { return new Response("Invalid setup request", { status: 400 }); }
  if (!input || typeof input !== "object" || !("action" in input)
    || input.action !== "setup" || !("requestId" in input)
    || typeof input.requestId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)
    || Object.keys(input).some((key) => key !== "action" && key !== "requestId"))
    return new Response("Invalid setup request", { status: 400 });
  try {
    await enqueueOwnerSmsSetup(input.requestId);
    const result = await processOwnerSmsAlertQueue();
    return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Alert setup unavailable." }, { status: 503 });
  }
}
