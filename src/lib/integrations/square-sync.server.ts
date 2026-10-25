import "server-only";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database.generated";
import { sanitizeIntegrationError } from "./adapters";
import { SquareReadClient, squareSourceHash, type SquareReadConfiguration } from "./square-read.server";

const scopeSchema = z.object({ environment: z.literal("sandbox"), merchantId: z.string(), locationId: z.string(),
  currency: z.literal("USD"), timeZone: z.string(), mode: z.literal("source_evidence_only"), contract: z.literal("square-source-evidence-v1") });
const receiptSchema = z.object({ id: z.uuid(), recordsProcessed: z.number().int().nonnegative(), versionsInserted: z.number().int().nonnegative(),
  headsAdvanced: z.number().int().nonnegative(), replayedRecords: z.number().int().nonnegative(), staleRecords: z.number().int().nonnegative(),
  sourceCounts: z.object({ orders: z.number().int().nonnegative(), payments: z.number().int().nonnegative(), refunds: z.number().int().nonnegative() }),
  windowFrom: z.string(), windowTo: z.string(), financialPostingEnabled: z.literal(false), reconciliation: z.literal("pending"), replayed: z.boolean() });
export const squareSyncInputSchema = z.object({ requestId: z.uuid(), windowFrom: z.iso.datetime({ offset: true }), windowTo: z.iso.datetime({ offset: true }) }).strict().superRefine((value, ctx) => {
  const range = Date.parse(value.windowTo) - Date.parse(value.windowFrom);
  if (range <= 0 || range > 31 * 86400000 || Date.parse(value.windowTo) > Date.now() + 60000) ctx.addIssue({ code: "custom", message: "A bounded elapsed Square source window is required." });
});
export type SquareSyncInput = z.infer<typeof squareSyncInputSchema>;
type Admin = ReturnType<typeof createAdminClient>;
export class SquareSourceSyncError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "SquareSourceSyncError"; }
}
function sameInstant(a: string, b: string) { return Date.parse(a) === Date.parse(b); }

export async function runSquareSourceSync(input: SquareSyncInput, dependencies: {
  admin: Admin; connectionId: string; accessToken: string;
  makeReader?: (configuration: SquareReadConfiguration) => Pick<SquareReadClient, "readWindow">;
}) {
  const request = squareSyncInputSchema.parse(input), connectionId = z.uuid().parse(dependencies.connectionId), admin = dependencies.admin;
  const loaded = await admin.from("integration_connections").select("id, organization_id, location_id, provider, status, configuration").eq("id", connectionId).eq("provider", "square").maybeSingle();
  if (loaded.error || !loaded.data || !loaded.data.location_id || !["pending", "connected", "degraded"].includes(loaded.data.status)) throw new SquareSourceSyncError("An enabled Square source connection is required.", 409);
  const connection = loaded.data, config = connection.configuration as Record<string, Json | undefined>;
  const scope = scopeSchema.parse(config.squareScope);
  if (config.financialPostingEnabled !== false) throw new SquareSourceSyncError("Square financial posting must remain disabled for this rehearsal.", 409);
  const existing = await admin.from("integration_sync_jobs").select("id, connection_id, resource_type, direction, status, cursor").eq("id", request.requestId).maybeSingle();
  if (existing.error) throw new SquareSourceSyncError("The source request receipt could not be checked.", 503);
  if (existing.data) {
    let previous: { windowFrom?: string; windowTo?: string; result?: unknown; squareScope?: unknown };
    try { previous = JSON.parse(existing.data.cursor ?? "null"); } catch { throw new SquareSourceSyncError("The existing source request requires review.", 409); }
    if (existing.data.connection_id !== connectionId || existing.data.resource_type !== "square_source_evidence" || existing.data.direction !== "import" || !previous || squareSourceHash(previous.squareScope ?? null) !== squareSourceHash(scope) || !sameInstant(previous.windowFrom ?? "", request.windowFrom) || !sameInstant(previous.windowTo ?? "", request.windowTo)) throw new SquareSourceSyncError("The source request identity belongs to different scope or dates.", 409);
    if (existing.data.status === "succeeded") return { ...receiptSchema.parse(previous.result), replayed: true };
    if (existing.data.status !== "queued") throw new SquareSourceSyncError("A failed or running source attempt requires an Owner-approved queued retry with a new identity.", 409);
  }
  try {
    const reader = dependencies.makeReader?.({ ...scope, accessToken: dependencies.accessToken }) ?? new SquareReadClient({ ...scope, accessToken: dependencies.accessToken });
    const snapshots = await reader.readWindow(request.windowFrom, request.windowTo);
    const saved = await admin.rpc("service_ingest_square_source_window", {
      p_request_id: request.requestId, p_connection_id: connectionId, p_window_from: request.windowFrom, p_window_to: request.windowTo,
      p_snapshots: snapshots as unknown as Json,
    });
    if (saved.error) throw new SquareSourceSyncError("Square source persistence was refused: " + saved.error.code + ".", saved.error.code === "PT409" ? 409 : 502);
    return receiptSchema.parse(saved.data);
  } catch (error) {
    // Insert-only failure evidence cannot overwrite a success committed by a concurrent retry.
    const message = sanitizeIntegrationError(error instanceof Error ? error.message : "Square source read failed.");
    const failed = await admin.from("integration_sync_jobs").upsert({ id: request.requestId, organization_id: connection.organization_id, connection_id: connectionId,
      direction: "import", resource_type: "square_source_evidence", status: "failed", attempts: 1, records_processed: 0,
      error_message: message, cursor: JSON.stringify({ connectionId, squareScope: scope, windowFrom: request.windowFrom, windowTo: request.windowTo }),
      started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    }, { onConflict: "id", ignoreDuplicates: true });
    if (failed.error) throw new SquareSourceSyncError("Square source read and its failure receipt require review.", 503);
    const queuedFailure = await admin.from("integration_sync_jobs").update({ status: "failed", error_message: message, completed_at: new Date().toISOString() }).eq("id", request.requestId).eq("connection_id", connectionId).eq("resource_type", "square_source_evidence").eq("status", "queued");
    if (queuedFailure.error) throw new SquareSourceSyncError("The queued source failure requires review.", 503);
    throw error;
  }
}
