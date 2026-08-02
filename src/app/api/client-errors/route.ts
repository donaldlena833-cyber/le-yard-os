import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { getServerRuntimeConfiguration } from "@/lib/env.server";
import {
  clientErrorFingerprint,
  clientErrorRateLimitKey,
  FixedWindowRateLimiter,
  GENERIC_CLIENT_ERROR_MESSAGE,
  readBoundedJson,
  sanitizeClientErrorDigest,
} from "@/lib/security/client-error-reporting";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_BODY_BYTES = 512;
const rateLimiter = new FixedWindowRateLimiter();
const errorSchema = z
  .object({
    digest: z.string().trim().max(255).optional(),
  })
  .strict();

function runtimeEnvironment(): "development" | "preview" | "production" {
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return "development";
}

function jsonResponse(
  body: { accepted: boolean; persisted?: boolean },
  status: number,
  extraHeaders?: HeadersInit,
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  });
}

export async function POST(request: Request) {
  const parsed = errorSchema.safeParse(
    await readBoundedJson(request, MAX_BODY_BYTES).catch(() => null),
  );
  if (!parsed.success) return jsonResponse({ accepted: false }, 400);

  const runtime = getServerRuntimeConfiguration();
  if (!runtime.ready) return jsonResponse({ accepted: false }, 503);
  if (runtime.mode === "demo") {
    return jsonResponse({ accepted: true, persisted: false }, 202);
  }

  const resolution = await resolveWorkspaceSession().catch(() => null);
  if (!resolution) return jsonResponse({ accepted: false }, 503);
  if (resolution.status === "unauthenticated") {
    return jsonResponse({ accepted: false }, 401);
  }
  if (resolution.status === "configuration_error" || resolution.status === "data_error") {
    return jsonResponse({ accepted: false }, 503);
  }
  if (resolution.status !== "ready" || resolution.context.mode !== "live") {
    return jsonResponse({ accepted: false }, 403);
  }

  const workspace = resolution.context;
  const rateLimit = rateLimiter.consume(
    clientErrorRateLimitKey(workspace.organization.id, workspace.identity.userId),
  );
  if (!rateLimit.allowed) {
    return jsonResponse(
      { accepted: false },
      429,
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  const digest = sanitizeClientErrorDigest(parsed.data.digest);
  const record = {
    organization_id: workspace.organization.id,
    location_id: workspace.activeLocation.id,
    user_id: workspace.identity.userId,
    environment: runtimeEnvironment(),
    fingerprint: clientErrorFingerprint(digest),
    severity: "error",
    message: GENERIC_CLIENT_ERROR_MESSAGE,
    stack_trace: null,
    context: {
      digest,
      source: "workspace_error_boundary",
    },
  } as const;

  // application_errors intentionally has no browser insert policy. The
  // service-role write is limited to this server-derived, tenant-scoped row.
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("application_errors").insert(record);
    if (error) return jsonResponse({ accepted: false }, 503);
  } catch {
    return jsonResponse({ accepted: false }, 503);
  }

  return jsonResponse({ accepted: true, persisted: true }, 202);
}
