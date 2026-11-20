import { z } from "zod";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { appSurface } from "@/lib/app-surface";
import { verifyChurchLoyaltyScope } from "@/data/read-models/church-square-loyalty.server";
import { loyaltyRequest } from "@/lib/integrations/church-square-loyalty";
import { readChurchSquareLoyalty } from "@/lib/integrations/church-square-loyalty.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const respond = (status: number, body: object) => Response.json(body, { status, headers });

// Search phone numbers travel in the body, never URLs, browser history or logs.
export async function POST(request: Request) {
  if (appSurface !== "operations") return respond(404, { status: "not_found" });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    return respond(403, { status: "forbidden" });
  }
  if (new URL(request.url).search || request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
    return respond(400, { status: "invalid_request" });
  }
  try {
    const session = await resolveWorkspaceSession();
    if (session.status === "unauthenticated") return respond(401, { status: "unauthenticated" });
    if (session.status === "data_error" || session.status === "configuration_error") return respond(503, { status: "unavailable" });
    if (session.status !== "ready" || !await verifyChurchLoyaltyScope(session.context)) return respond(403, { status: "forbidden" });
    if (Number(request.headers.get("content-length")) > 4096) return respond(413, { status: "invalid_request" });
    const reader = request.body?.getReader();
    if (!reader) return respond(400, { status: "invalid_request" });
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 4096) { await reader.cancel(); return respond(413, { status: "invalid_request" }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const input = loyaltyRequest.parse(JSON.parse(Buffer.concat(chunks, length).toString("utf8")));
    const result = await readChurchSquareLoyalty(input);
    return respond(result.status === "unavailable" ? 503 : 200, result);
  } catch (error) {
    return respond(error instanceof SyntaxError || error instanceof z.ZodError ? 400 : 503,
      { status: error instanceof SyntaxError || error instanceof z.ZodError ? "invalid_request" : "unavailable" });
  }
}
