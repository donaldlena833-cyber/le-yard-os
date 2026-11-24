import { appSurface } from "@/lib/app-surface";
import { createAdminClient } from "@/lib/supabase/admin";
import { receiveCateringInquiry } from "@/lib/catering-receiver.server";

export const runtime = "nodejs";
export const maxDuration = 20;

export async function POST(request: Request) {
  if (appSurface !== "operations") return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return receiveCateringInquiry(request, {
    enabled: process.env.LE_YARD_CHURCH_CATERING_RECEIVER_ENABLED === "true",
    store: () => {
      const admin = createAdminClient();
      return {
        authenticate: async (keyHash) => admin.rpc("service_authenticate_catering_client", {
          p_key_hash: keyHash,
        }).abortSignal(AbortSignal.timeout(5_000)),
        capture: async (clientId, requestId, payload) => admin.rpc("service_capture_catering_inquiry", {
          p_client_id: clientId,
          p_request_id: requestId,
          p_payload: payload,
        }).abortSignal(AbortSignal.timeout(6_000)),
      };
    },
  });
}
