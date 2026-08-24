import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendIdentityDelivery,
  type IdentityDeliveryJob,
} from "@/lib/messaging/identity-delivery.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const expected = process.env.IDENTITY_DELIVERY_SECRET?.trim();
  const provided = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  if (!expected || !provided || expected.length < 32) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function run(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const admin = createAdminClient();
  const workerId = crypto.randomUUID();
  const { data, error } = await admin.rpc("service_claim_identity_delivery", {
    p_worker_id: workerId,
    p_limit: 25,
    p_lease_seconds: 120,
    p_now: new Date().toISOString(),
  } as never);
  if (error) {
    return Response.json(
      { error: "Identity delivery could not be claimed." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  let sent = 0;
  let failed = 0;
  let completionErrors = 0;
  for (const job of (data ?? []) as unknown as IdentityDeliveryJob[]) {
    let result: Awaited<ReturnType<typeof sendIdentityDelivery>>;
    try {
      result = await sendIdentityDelivery(job);
    } catch {
      result = { state: "failed", providerMessageId: null };
    }
    const retryAt = new Date(
      Date.now() + Math.min(60, 2 ** Math.max(1, job.attempts)) * 60_000,
    ).toISOString();
    const completion = await admin.rpc("service_complete_identity_delivery", {
      p_id: job.id,
      p_claim_token: job.claimToken,
      p_status: result.state === "sent" ? "sent" : "failed",
      p_provider_message_id: result.providerMessageId,
      p_error_code: result.state === "sent" ? null : result.state,
      p_next_attempt_at: result.state === "sent" ? null : retryAt,
    } as never);
    const completedState = (completion.data as { status?: unknown } | null)
      ?.status;
    const expectedState = result.state === "sent" ? "sent" : "failed";
    if (completion.error || completedState !== expectedState)
      completionErrors += 1;
    else if (result.state === "sent") sent += 1;
    else failed += 1;
  }

  const status = completionErrors ? 503 : 200;
  return Response.json(
    { data: { sent, failed, completionErrors } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  return run(request);
}
