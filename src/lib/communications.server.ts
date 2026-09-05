import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeE164 } from "@/lib/twilio.server";
import type { Json } from "@/types/database.generated";

export type LeYardTenant = { organizationId: string; locationId: string; timezone: string };
let tenantPromise: Promise<LeYardTenant> | null = null;

export function resolveLeYardTenant() {
  tenantPromise ??= (async () => {
    const admin = createAdminClient();
    const configuredLocation = process.env.LE_YARD_LOCATION_ID?.trim();
    let query = admin.from("locations").select("id,organization_id,timezone").limit(1);
    query = configuredLocation ? query.eq("id", configuredLocation) : query.eq("name", "Le Yard");
    const { data, error } = await query.maybeSingle();
    if (error || !data) throw new Error("Le Yard tenant/location could not be resolved.");
    return { organizationId: data.organization_id, locationId: data.id, timezone: data.timezone };
  })().catch((error) => { tenantPromise = null; throw error; });
  return tenantPromise;
}

export async function logCommunicationEvent(input: {
  eventType: string;
  message: string;
  severity?: "debug" | "info" | "warning" | "error";
  metadata?: Record<string, Json | undefined>;
}, options: { required?: boolean } = {}) {
  try {
    const tenant = await resolveLeYardTenant();
    const metadata = Object.fromEntries(Object.entries(input.metadata ?? {}).filter(([, value]) => value !== undefined)) as Json;
    const { error } = await createAdminClient().from("integration_events").insert({
      organization_id: tenant.organizationId, connection_id: null,
      event_type: input.eventType, severity: input.severity ?? "info", message: input.message, metadata,
    });
    if (error) throw new Error("Communication could not be persisted.");
    return true;
  } catch {
    console.error("communications_event_log_failed");
    if (options.required) throw new Error("Communication could not be persisted.");
    return false;
  }
}

function digits(value: string) { return value.replace(/\D/g, ""); }

export async function findGuestByPhone(phone: string) {
  const target = digits(normalizeE164(phone));
  const tenant = await resolveLeYardTenant();
  const { data, error } = await createAdminClient().from("guests")
    .select("id,display_name,first_name,last_name,email,phone,vip,visit_count,lifetime_spend_cents,preferences,allergies,notes")
    .eq("organization_id", tenant.organizationId).is("merged_into_id", null).not("phone", "is", null).limit(1000);
  if (error) throw error;
  return data.find((guest) => guest.phone && digits(guest.phone) === target) ?? null;
}

// Destination-scoped service consent also covers new callers not yet in the CRM.
// Never convert this to marketing consent or impersonate an authenticated guest.
export async function recordServiceSmsConsent(input: { phone: string; evidence: string }) {
  return logCommunicationEvent({
    eventType: "sms.consent.granted", message: "Service SMS consent recorded.",
    metadata: { phone: normalizeE164(input.phone), evidence: input.evidence, purpose: "guest_care" },
  }, { required: true });
}
export async function revokeServiceSmsConsent(input: { phone: string; evidence: string }) {
  return logCommunicationEvent({
    eventType: "sms.consent.revoked", message: "Service SMS consent withdrawn.",
    metadata: { phone: normalizeE164(input.phone), evidence: input.evidence, purpose: "guest_care" },
  }, { required: true });
}
export async function hasServiceSmsConsent(phone: string) {
  const tenant = await resolveLeYardTenant();
  const { data, error } = await createAdminClient().from("integration_events")
    .select("event_type,occurred_at").eq("organization_id", tenant.organizationId)
    .in("event_type", ["sms.consent.granted", "sms.consent.revoked"])
    .contains("metadata", { phone: normalizeE164(phone), purpose: "guest_care" })
    .order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("SMS consent could not be checked.");
  return data?.event_type === "sms.consent.granted";
}

const privateEventTerms = ["buyout", "private event", "private dinner", "corporate event", "corporate dinner", "birthday party", "engagement party", "rehearsal dinner", "wedding", "company dinner", "holiday party"];
export function detectPrivateEventLead(text: string, partySize?: number | null) {
  const normalized = text.toLowerCase();
  const matchedTerm = privateEventTerms.find((term) => normalized.includes(term));
  return { isLead: Boolean(matchedTerm) || (partySize ?? 0) >= 12,
    matchedTerm: matchedTerm ?? ((partySize ?? 0) >= 12 ? "large_party" : null) };
}
export function detectReservationIntent(text: string) {
  return /\b(reservation|reserve|book|booking|table|party of|dinner|brunch|lunch)\b/i.test(text);
}
export async function notifyOwnersOfCommunication(input: { title: string; body: string; eventType: string }) {
  const tenant = await resolveLeYardTenant();
  const admin = createAdminClient();
  const { data: memberships, error } = await admin.from("organization_memberships").select("user_id")
    .eq("organization_id", tenant.organizationId).eq("status", "active").in("role", ["owner", "admin"]);
  if (error) { console.error("communications_owner_lookup_failed"); return; }
  if (!memberships.length) return;
  const { error: insertError } = await admin.from("notifications").insert(memberships.map((membership) => ({
    organization_id: tenant.organizationId, user_id: membership.user_id, notification_type: input.eventType,
    title: input.title, body: input.body, action_url: "/reservations", entity_type: null, entity_id: null,
  })));
  if (insertError) console.error("communications_owner_notification_failed");
}
