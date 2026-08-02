import { getServerRuntimeConfiguration } from "@/lib/env.server";

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export function unavailableLiveReportExportResponse(): Response | null {
  const runtime = getServerRuntimeConfiguration();
  if (!runtime.ready) {
    return Response.json(
      { error: "Service configuration is unavailable." },
      { status: 503, headers: responseHeaders },
    );
  }
  return null;
}
