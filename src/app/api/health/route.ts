import { NextResponse } from "next/server";
import { getServerRuntimeConfiguration } from "@/lib/env.server";
import { buildHealthState } from "@/lib/security/health";

export function GET() {
  const runtime = getServerRuntimeConfiguration();
  const health = buildHealthState(runtime.ready, new Date().toISOString());

  return NextResponse.json(health.body, {
    status: health.statusCode,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
