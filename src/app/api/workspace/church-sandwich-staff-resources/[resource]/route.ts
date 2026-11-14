import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isWorkspaceRouteAccessible } from "@/components/shell/navigation";
import { loadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";
import { appSurface } from "@/lib/app-surface";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const filenames = new Map([
  ["training", "sandwich-station-training.pdf"],
  ["supplier-intake", "supplier-label-intake.pdf"],
  ["batch-labels", "kitchen-batch-labels.pdf"],
]);

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  const filename = filenames.get((await context.params).resource);
  if (appSurface !== "operations" || !filename) return new Response(null, { status: 404, headers });
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return new Response(null, { status: 403, headers });
  }

  try {
    const session = await resolveWorkspaceSession();
    if (session.status === "unauthenticated") return new Response(null, { status: 401, headers });
    if (session.status === "configuration_error" || session.status === "data_error") {
      return new Response(null, { status: 503, headers });
    }
    if (session.status !== "ready" || !isWorkspaceRouteAccessible("/kitchen", session.context)) {
      return new Response(null, { status: 403, headers });
    }

    const evidence = await loadChurchIngredientEvidence(session.context);
    if (!evidence) return new Response(null, { status: 403, headers });
    if (!evidence.ok) return new Response(null, { status: 503, headers });

    const file = await readFile(join(process.cwd(), "docs", "church-street-kitchen", filename));
    return new Response(new Uint8Array(file), {
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="church-street-${filename}"`,
      },
    });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
