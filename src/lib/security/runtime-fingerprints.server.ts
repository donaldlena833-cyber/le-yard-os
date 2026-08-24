import "server-only";

import { createHash } from "node:crypto";
import { EXPECTED_SCHEMA_CONTRACT } from "@/lib/security/schema-contract";

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function runtimeHealthFingerprints(input: {
  runtime: { mode: string; ready: boolean; playground?: boolean };
  schemaFingerprint: string | null;
}) {
  return {
    configuration: fingerprint({
      mode: input.runtime.mode,
      ready: input.runtime.ready,
      playground: input.runtime.playground === true,
      supabaseUrlPresent: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()),
      supabasePublishableKeyPresent: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
      ),
      supabaseSecretKeyPresent: Boolean(process.env.SUPABASE_SECRET_KEY?.trim()),
      publicBookingEmergencyGate:
        process.env.RESERVATION_PUBLIC_BOOKING_ENABLED?.trim() === "false"
          ? "paused"
          : "database_authority_required",
      reservationDeliveryWorkerReady:
        (process.env.RESERVATION_DELIVERY_SECRET?.trim().length ?? 0) >= 32,
      identityDeliveryWorkerReady:
        (process.env.IDENTITY_DELIVERY_SECRET?.trim().length ?? 0) >= 32,
      guestVerificationReady:
        (process.env.GUEST_INTEREST_VERIFICATION_SECRET?.trim().length ?? 0) >=
        32,
      emailProviderReady: Boolean(
        process.env.RESEND_API_KEY?.trim() &&
          (process.env.LE_YARD_TRANSACTIONAL_EMAIL_FROM?.trim() ||
            process.env.RESERVATION_EMAIL_FROM?.trim()),
      ),
      smsProviderEnabled:
        process.env.RESERVATION_SMS_DELIVERY_ENABLED?.trim() === "true",
      toastLaborReady: Boolean(
        process.env.TOAST_CLIENT_ID?.trim() &&
          process.env.TOAST_CLIENT_SECRET?.trim() &&
          process.env.TOAST_RESTAURANT_GUID?.trim() &&
          process.env.TOAST_LOCATION_ID?.trim() &&
          (process.env.TOAST_LABOR_SYNC_SECRET?.trim().length ?? 0) >= 32,
      ),
      ownerIntelligenceEnabled:
        process.env.LE_YARD_OWNER_INTELLIGENCE_ENABLED?.trim() === "true",
      ownerIntelligenceProvider:
        process.env.LE_YARD_OWNER_INTELLIGENCE_PROVIDER?.trim() ||
        "codex_subscription",
    }),
    release: fingerprint({
      commit:
        process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
        process.env.LE_YARD_RELEASE_SHA?.trim() ||
        "unknown",
      migrationHead: EXPECTED_SCHEMA_CONTRACT.migrationHead,
      environment: process.env.VERCEL_ENV?.trim() || "local",
    }),
    schema: input.schemaFingerprint,
  };
}
