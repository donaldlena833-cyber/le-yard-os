import { createAdminClient } from "@/lib/supabase/admin";
import { resolveLeYardTenant, notifyOwnersOfCommunication } from "@/lib/communications.server";
import {
  readTwilioForm, twilioForwardNumbers, twilioRestClient, twilioPhoneNumber,
  validateTwilioRequest,
} from "@/lib/twilio.server";

export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params))
    return new Response("Forbidden", { status: 403 });
  const sid = params.get("MessageSid") ?? "";
  const id = new URL(request.url).searchParams.get("alert") ?? "";
  if (!/^(SM|MM)[0-9a-f]{32}$/i.test(sid)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return new Response("Invalid alert", { status: 400 });
  try {
    const tenant = await resolveLeYardTenant();
    const admin = createAdminClient();
    const { data: alert, error } = await admin.from("owner_sms_alerts")
      .select("id,recipient,source_sid,provider_sid,status")
      .eq("organization_id", tenant.organizationId)
      .eq("location_id", tenant.locationId).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!alert || (alert.provider_sid && alert.provider_sid !== sid))
      return new Response("Forbidden", { status: 403 });
    const recipients = twilioForwardNumbers();
    const recipient = alert.recipient as keyof typeof recipients;
    // Read current state rather than trust possibly out-of-order callback data.
    const message = await twilioRestClient().messages(sid).fetch();
    if (message.sid !== sid || message.from !== twilioPhoneNumber() || message.to !== recipients[recipient]
      || message.direction === "inbound")
      return new Response("Forbidden", { status: 403 });
    const failed = message.status === "failed" || message.status === "undelivered" || message.status === "canceled";
    const delivered = message.status === "delivered" || message.status === "read";
    // A delivered record is terminal even if a concurrent older fetch finishes later.
    if (alert.status === "delivered" && !delivered) return new Response(null, { status: 204 });
    const { error: updateError, data: updated } = await admin.from("owner_sms_alerts").update({
      provider_sid: sid,
      provider_status: message.status,
      status: delivered ? "delivered" : failed ? "failed" : "accepted",
      error_code: message.errorCode == null ? null : String(message.errorCode),
      completed_at: delivered || failed ? new Date().toISOString() : null,
    }).eq("organization_id", tenant.organizationId).eq("location_id", tenant.locationId).eq("id", id)
      .neq("status", "delivered").select("id");
    if (updateError) throw updateError;
    if (failed && alert.status !== "failed" && updated?.length) {
      await notifyOwnersOfCommunication({
        title: "Personal text alert not delivered",
        body: `The ${alert.recipient} alert could not be delivered. The original message remains in the shared inbox.`,
        eventType: "owner_sms_alert_failed",
        actionUrl: alert.source_sid ? `/messages?message=${alert.source_sid}` : "/messages",
      });
    }
    return new Response(null, { status: 204 });
  } catch {
    return new Response("Alert status temporarily unavailable", { status: 503 });
  }
}
