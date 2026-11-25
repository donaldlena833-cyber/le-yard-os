import { timingSafeEqual } from "node:crypto";
import { appSurface } from "@/lib/app-surface";
import { processChurchMusicSchedules } from "@/lib/integrations/music-schedule.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (appSurface !== "operations") return new Response(null, { status: 404, headers });
  const secret = process.env.MUSIC_SCHEDULER_SECRET?.trim() ?? "";
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (secret.length < 32) return new Response(null, { status: 503, headers });
  if (Buffer.byteLength(auth) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) return new Response(null, { status: 401, headers });
  if (new URL(request.url).search) return new Response(null, { status: 400, headers });
  try {
    await processChurchMusicSchedules();
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
