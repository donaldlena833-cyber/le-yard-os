import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSquareSourceSync, squareSyncInputSchema, SquareSourceSyncError } from "@/lib/integrations/square-sync.server";

export const runtime = "nodejs";
function json(body: object, status = 200) { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }
function authorized(request: Request): boolean {
  const expected = process.env.SQUARE_SOURCE_SYNC_SECRET?.trim(), provided = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!expected || expected.length < 32 || !provided) return false;
  const a = Buffer.from(expected), b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function readBody(request: Request): Promise<unknown> {
  if (!request.body) throw new SquareSourceSyncError("A source request body is required.", 400);
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength;
      if (size > 4096) throw new SquareSourceSyncError("The source request is too large.", 413); chunks.push(item.value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new SquareSourceSyncError("The source request must be JSON.", 400); }
}
export async function POST(request: Request) {
  if (!authorized(request)) return json({ error: "Unauthorized" }, 401);
  if (process.env.LE_YARD_SQUARE_SOURCE_SYNC_ENABLED?.trim() !== "true") return json({ error: "Square source sync is disabled." }, 503);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return json({ error: "A JSON source request is required." }, 415);
  const connectionId = process.env.SQUARE_SOURCE_CONNECTION_ID?.trim(), accessToken = process.env.SQUARE_SANDBOX_ACCESS_TOKEN?.trim();
  if (!connectionId || !accessToken) return json({ error: "Square Sandbox configuration is unavailable." }, 503);
  try {
    const input = squareSyncInputSchema.safeParse(await readBody(request));
    if (!input.success) return json({ error: "Valid request identity and elapsed source dates are required." }, 400);
    const result = await runSquareSourceSync(input.data, { admin: createAdminClient(), connectionId, accessToken });
    return json({ ...result, providerAccepted: false });
  } catch (error) {
    return json({ error: error instanceof SquareSourceSyncError ? error.message : "Square source sync requires review." }, error instanceof SquareSourceSyncError ? error.status : 502);
  }
}
