import { after } from "next/server";
import { z } from "zod";
import { churchSquareWebhookConfiguration, churchSquareWebhookUrl, prepareChurchSquareWebhook } from "@/lib/integrations/church-square-webhook.server";
import { processChurchSquareReceipts } from "@/lib/integrations/church-square-event-worker.server";
import { verifySquareWebhookSignature } from "@/lib/integrations/square-read.server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const maxBodyBytes = 1_048_576;
const signaturePattern = /^[A-Za-z0-9+/]{43}=$/;

function respond(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

async function readBody(request: Request): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, totalBytes);
      totalBytes += value.byteLength;
      if (totalBytes > maxBodyBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const config = churchSquareWebhookConfiguration();
  if (!config) return respond(503);

  const signature = request.headers.get("x-square-hmacsha256-signature");
  if (!signature || !signaturePattern.test(signature)) return respond(401);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return respond(415);
  if (Number(request.headers.get("content-length")) > maxBodyBytes) return respond(413);

  try {
    const rawBody = await readBody(request);
    if (!rawBody) return respond(413);
    if (!verifySquareWebhookSignature({
      rawBody,
      signature,
      signatureKey: config.signatureKey,
      notificationUrl: churchSquareWebhookUrl,
    })) return respond(401);

    const receipt = prepareChurchSquareWebhook(JSON.parse(rawBody.toString("utf8")), config);
    if (receipt === "ignore") return respond(204);

    const { error } = await createAdminClient().rpc("service_record_church_square_webhook", {
      p_merchant_id: config.merchantId,
      p_square_location_id: config.squareLocationId,
      p_event_id: receipt.eventId,
      p_event_type: receipt.eventType,
      p_created_at: receipt.createdAt,
      p_resource_id: receipt.resourceId,
      p_related_order_id: receipt.relatedOrderId,
      p_inventory: receipt.inventory,
    }).abortSignal(AbortSignal.timeout(6_000));
    if (error) return respond(503);
    if (receipt.eventType !== "inventory.count.updated") after(processChurchSquareReceipts);
    return respond(204);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return respond(400);
    return respond(503);
  }
}
