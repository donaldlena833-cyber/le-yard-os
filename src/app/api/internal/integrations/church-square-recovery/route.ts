import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { processChurchSquareReceipts } from "@/lib/integrations/church-square-event-worker.server";
import { processChurchSquareOrderBackfill } from "@/lib/integrations/church-square-order-backfill.server";
import { churchSquareOrderConfiguration } from "@/lib/integrations/church-square-orders.server";

export const runtime = "nodejs";
export const maxDuration = 60;

const recoveryUrl = "https://operations.leyardny.com/api/internal/integrations/church-square-recovery";
const signaturePrefix = "le-yard-church-square-recovery/v1:";

function respond(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

async function hasNoInput(request: Request) {
  const length = request.headers.get("content-length");
  if (length !== null && length !== "0" && length !== "2") return false;
  if (!request.body) return length !== "2";
  const reader = request.body.getReader();
  const expected = [0x7b, 0x7d];
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return (offset === 0 && length !== "2") || (
        offset === expected.length && length !== "0" &&
        request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "application/json"
      );
      for (const byte of value) {
        if (byte !== expected[offset++]) return false;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  if (request.url !== recoveryUrl) return respond(400);
  const secret = process.env.LE_YARD_CHURCH_SQUARE_RECOVERY_SECRET?.trim() ?? "";
  if (!/^[!-~]{32,256}$/.test(secret) || !churchSquareOrderConfiguration()) return respond(503);

  const epoch = request.headers.get("x-le-yard-epoch") ?? "";
  const signature = request.headers.get("x-le-yard-recovery-signature") ?? "";
  if (!/^\d{10}$/.test(epoch) || !/^[0-9a-f]{64}$/.test(signature) ||
    Math.abs(Math.floor(Date.now() / 1_000) - Number(epoch)) > 90) return respond(401);
  const expected = createHmac("sha256", secret).update(signaturePrefix + epoch, "utf8").digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return respond(401);

  try {
    if (!await hasNoInput(request)) return respond(400);
    after(async () => {
      await Promise.allSettled([processChurchSquareReceipts(), processChurchSquareOrderBackfill()]);
    });
    return respond(202);
  } catch {
    return respond(503);
  }
}
