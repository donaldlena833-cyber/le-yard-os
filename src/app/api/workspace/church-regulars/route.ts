import { z } from "zod";
import { appSurface } from "@/lib/app-surface";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { verifyChurchLoyaltyScope } from "@/data/read-models/church-square-loyalty.server";
import { regularsRequest } from "@/lib/integrations/church-regulars-streak";
import { manageChurchRegulars, RegularsConflict } from "@/lib/integrations/church-regulars-streak.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const respond = (status: number, body: object) => Response.json(body, { status, headers });

export async function POST(request: Request) {
  if (appSurface !== "operations") return respond(404, { status: "not_found" });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return respond(403, { status: "forbidden" });
  if (new URL(request.url).search || request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") return respond(400, { status: "invalid_request" });
  try {
    const session = await resolveWorkspaceSession();
    if (session.status === "unauthenticated") return respond(401, { status: "unauthenticated" });
    if (["data_error", "configuration_error"].includes(session.status)) return respond(503, { status: "unavailable" });
    if (session.status !== "ready" || !await verifyChurchLoyaltyScope(session.context)) return respond(403, { status: "forbidden" });
    if (Number(request.headers.get("content-length")) > 2048) return respond(413, { status: "invalid_request" });
    const reader = request.body?.getReader();
    if (!reader) return respond(400, { status: "invalid_request" });
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > 2048) { await reader.cancel(); return respond(413, { status: "invalid_request" }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const input = regularsRequest.parse(JSON.parse(Buffer.concat(chunks, length).toString("utf8")));
    return respond(200, { status: "active", journey: await manageChurchRegulars(session.context, input) });
  } catch (error) {
    if (error instanceof RegularsConflict) return respond(409, { status: "changed", message: error.message });
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
    return respond(invalid ? 400 : 503, { status: invalid ? "invalid_request" : "unavailable" });
  }
}
