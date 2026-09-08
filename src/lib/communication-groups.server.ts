import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveLeYardTenant } from "@/lib/communications.server";
import { twilioForwardNumbers, twilioPhoneNumber } from "@/lib/twilio.server";

export type TranscriptInput = {
  sid: string;
  from: string;
  to: string;
  body: string;
  status: string;
  at: string;
  mediaCount?: number;
  errorCode?: string | number | null;
  senderKind?: "staff" | "automation" | "unknown";
  actorId?: string;
};
export async function saveCommunicationMessage(input: TranscriptInput) {
  const business = twilioPhoneNumber();
  if (
    !/^(SM|MM)[a-f0-9]{32}$/i.test(input.sid) ||
    (input.from !== business && input.to !== business)
  )
    throw new Error("Message outside Le Yard scope.");
  const tenant = await resolveLeYardTenant();
  const admin = createAdminClient();
  const outbound = input.from === business;
  let staff: string[] = [];
  try {
    staff = Object.values(twilioForwardNumbers());
  } catch {
    /* Intake is unavailable until staff phones are configured. */
  }
  const phone = outbound ? input.to : input.from;
  const { data: employees, error: employeeError } = await admin.rpc(
    "communication_employee_for_phone",
    { p_organization_id: tenant.organizationId, p_phone: phone },
  );
  if (employeeError) throw new Error("Team contact lookup unavailable.");
  const employee = employees?.[0];
  const internal = Boolean(employee || staff.includes(phone));
  const { data: previous, error: readError } = await admin
    .from("communication_messages")
    .select("sender_kind,actor_id,sent_at,body,audience,contact_name")
    .eq("organization_id", tenant.organizationId)
    .eq("sid", input.sid)
    .maybeSingle();
  if (readError) throw new Error("Transcript unavailable.");
  const { error } = await admin.from("communication_messages").upsert(
    {
      organization_id: tenant.organizationId,
      location_id: tenant.locationId,
      sid: input.sid,
      from_number: input.from,
      to_number: input.to,
      body: previous?.body ?? input.body,
      direction: outbound ? "outbound" : "inbound",
      sender_kind: outbound
        ? input.senderKind && input.senderKind !== "unknown"
          ? input.senderKind
          : (previous?.sender_kind ?? "unknown")
        : internal
          ? "staff"
          : "client",
      audience: internal || previous?.audience === "team" ? "team" : "client",
      contact_name: employee?.display_name ?? previous?.contact_name ?? null,
      actor_id: input.actorId ?? previous?.actor_id ?? null,
      media_count: Math.min(10, Math.max(0, input.mediaCount ?? 0)),
      status: input.status,
      error_code: input.errorCode == null ? null : String(input.errorCode),
      sent_at: previous?.sent_at ?? input.at,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,sid" },
  );
  if (error) throw new Error("Transcript could not be saved.");
  return { internal };
}

export async function communicationThreadMode(phone: string) {
  const tenant = await resolveLeYardTenant();
  const { data, error } = await createAdminClient()
    .from("communication_threads")
    .select("mode")
    .eq("organization_id", tenant.organizationId)
    .eq("phone", phone)
    .maybeSingle();
  if (error) throw new Error("Conversation handoff state unavailable.");
  return data?.mode ?? "automation";
}
export async function setCommunicationThreadMode(
  phone: string,
  mode: "human" | "automation",
  reason?: string,
) {
  const tenant = await resolveLeYardTenant();
  const { error } = await createAdminClient()
    .from("communication_threads")
    .upsert(
      {
        organization_id: tenant.organizationId,
        location_id: tenant.locationId,
        phone,
        mode,
        reason: reason ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,phone" },
    );
  if (error) throw new Error("Conversation handoff state could not be saved.");
}
