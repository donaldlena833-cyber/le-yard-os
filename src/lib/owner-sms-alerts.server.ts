import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyOwnersOfCommunication, resolveLeYardTenant } from "@/lib/communications.server";
import {
  twilioAbsoluteUrl,
  twilioForwardNumbers,
  twilioPhoneNumber,
  twilioRestClient,
  twilioSmsEnabled,
} from "@/lib/twilio.server";
import {
  formatOwnerSmsAlert,
  ownerSmsConversationUrl,
  ownerSmsReplyGuidance,
  ownerSmsSetupMessage,
} from "@/lib/owner-sms-alerts";
import type { Database } from "@/types/database.generated";

type Alert = Database["public"]["Tables"]["owner_sms_alerts"]["Row"];
type Recipient = "donald" | "maris";
const recipients: Recipient[] = ["donald", "maris"];
const messageSid = /^(SM|MM)[a-f0-9]{32}$/i;
const setupId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ownerSmsAlertsEnabled(): boolean {
  return process.env.TWILIO_OWNER_SMS_ALERTS_ENABLED?.trim() === "true" && twilioSmsEnabled();
}

export function isOwnerSmsAlertRecipient(phone: string): boolean {
  try {
    return Object.values(twilioForwardNumbers()).includes(phone);
  } catch {
    return false;
  }
}

async function enqueue(input: {
  sourceSid: string | null;
  sourceKey: string;
  recipients: Recipient[];
  parts: string[];
}): Promise<string[]> {
  if (!ownerSmsAlertsEnabled()) return [];
  const tenant = await resolveLeYardTenant();
  const rows = input.parts.flatMap((body, index) => input.recipients.map((recipient) => ({
    organization_id: tenant.organizationId,
    location_id: tenant.locationId,
    source_sid: input.sourceSid,
    source_key: input.sourceKey,
    recipient,
    part: index + 1,
    body,
  })));
  const { data, error } = await createAdminClient()
    .from("owner_sms_alerts")
    .upsert(rows, {
      onConflict: "organization_id,source_key,recipient,part",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) throw new Error("owner_alert_enqueue_unavailable");
  return (data ?? []).map((row) => row.id);
}

export async function enqueueOwnerSmsAlerts(input: {
  sourceSid: string;
  from: string;
  body: string;
  mediaCount: number;
  guestName?: string | null;
}): Promise<string[]> {
  if (!ownerSmsAlertsEnabled()) return [];
  // Validate the configured internal destination set before classifying intake.
  // Do not turn missing forwarding configuration into a guest alert loop.
  const configured = twilioForwardNumbers();
  if (input.from === twilioPhoneNumber() || Object.values(configured).includes(input.from)) return [];
  return enqueue({
    sourceSid: input.sourceSid,
    sourceKey: input.sourceSid,
    recipients,
    parts: formatOwnerSmsAlert({ ...input, guestName: input.guestName ?? undefined }),
  });
}

export async function enqueueOwnerSmsReplyGuidance(input: {
  sourceSid: string;
  from: string;
}): Promise<string[]> {
  if (!ownerSmsAlertsEnabled()) return [];
  if (!messageSid.test(input.sourceSid)) throw new Error("owner_alert_source_invalid");
  const configured = twilioForwardNumbers();
  const recipient = recipients.find((candidate) => configured[candidate] === input.from);
  if (!recipient || input.from === twilioPhoneNumber()) return [];
  return enqueue({
    sourceSid: input.sourceSid,
    sourceKey: input.sourceSid,
    recipients: [recipient],
    parts: [`Le Yard Messages\n${ownerSmsReplyGuidance()}`],
  });
}

export async function enqueueOwnerSmsSetup(requestId: string): Promise<string[]> {
  if (!ownerSmsAlertsEnabled()) return [];
  if (!setupId.test(requestId)) throw new Error("owner_alert_setup_id_invalid");
  return enqueue({
    sourceSid: null,
    sourceKey: `setup:${requestId}`,
    recipients,
    parts: [ownerSmsSetupMessage()],
  });
}

function safeProviderError(error: unknown): { definitive: boolean; code: string } {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = typeof value.status === "number" ? value.status : 0;
  const code = typeof value.code === "number" || typeof value.code === "string" ? String(value.code) : "";
  return {
    definitive: Number.isInteger(status) && status >= 400 && status < 500 && status !== 408,
    code: /^\d{3,8}$/.test(code)
      ? `provider_${code}`
      : Number.isInteger(status) && status >= 400 && status <= 599
        ? `provider_http_${status}`
        : "provider_unconfirmed",
  };
}

async function notifyFailure(alert: Alert, errorCode: string) {
  const label = alert.recipient === "donald" ? "Donald" : "Maris";
  // The provider's raw error may contain personal destinations or credentials.
  // Only bounded status codes reach this in-app notification; no SMS is sent.
  const code = /^[a-z_0-9]{1,64}$/.test(errorCode) ? errorCode : "delivery_unconfirmed";
  try {
    await notifyOwnersOfCommunication({
      title: "Le Yard Messages alert needs review",
      body: `An internal SMS alert to ${label} could not be confirmed (${code}). Open the shared inbox to review it before retrying.`,
      eventType: "owner_sms_alert_review",
      actionUrl: alert.source_sid ? ownerSmsConversationUrl(alert.source_sid) : "https://phone.leyardny.com/messages",
    });
  } catch {
    console.error("owner_sms_alert_notification_unavailable");
  }
}

export async function processOwnerSmsAlertQueue() {
  const stopStartingAt = Date.now() + 40_000;
  const summary = { considered: 0, claimed: 0, accepted: 0, failed: 0, uncertain: 0, skipped: 0 };
  if (!ownerSmsAlertsEnabled()) return summary;
  // Resolve private numbers only in server memory. The outbox stores stable
  // owner labels, so neither database rows nor callback URLs expose them.
  const configured = twilioForwardNumbers();
  const from = twilioPhoneNumber();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  if (!messagingServiceSid || !/^MG[0-9a-f]{32}$/i.test(messagingServiceSid)) {
    throw new Error("owner_alert_configuration_unavailable");
  }
  const callbackBase = twilioAbsoluteUrl("/api/twilio/sms/owner-alert-status");
  const client = twilioRestClient();
  const tenant = await resolveLeYardTenant();
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: jobs, error } = await admin
    .from("owner_sms_alerts")
    .select("*")
    .eq("organization_id", tenant.organizationId)
    .eq("location_id", tenant.locationId)
    .or(`status.eq.queued,and(status.eq.sending,started_at.lt.${cutoff}),and(status.eq.sending,started_at.is.null,created_at.lt.${cutoff})`)
    .order("created_at", { ascending: true })
    .order("source_key", { ascending: true })
    .order("part", { ascending: true })
    .order("recipient", { ascending: true })
    .limit(16);
  if (error) throw new Error("owner_alert_queue_unavailable");
  summary.considered = jobs?.length ?? 0;

  async function saveOutcome(alert: Alert, outcome: {
    status: "accepted" | "delivered" | "failed" | "uncertain";
    provider_sid?: string;
    provider_status?: string;
    error_code?: string;
  }) {
    const result = await admin.from("owner_sms_alerts")
      .update({ ...outcome, completed_at: new Date().toISOString() })
      .eq("organization_id", tenant.organizationId)
      .eq("location_id", tenant.locationId)
      .eq("id", alert.id)
      // A delivery callback may arrive before messages.create resolves.
      .eq("status", "sending")
      .select("id");
    if (result.error) throw new Error("owner_alert_outcome_unavailable");
    return Boolean(result.data?.length);
  }

  async function stopLaterParts(alert: Alert) {
    const result = await admin.from("owner_sms_alerts")
      .update({ status: "uncertain", error_code: "earlier_part_unconfirmed", completed_at: new Date().toISOString() })
      .eq("organization_id", tenant.organizationId)
      .eq("location_id", tenant.locationId)
      .eq("source_key", alert.source_key)
      .eq("recipient", alert.recipient)
      .gt("part", alert.part)
      .eq("status", "queued");
    if (result.error) throw new Error("owner_alert_later_parts_unavailable");
  }

  async function processJob(job: Alert) {
    if (!ownerSmsAlertsEnabled() || Date.now() >= stopStartingAt) { summary.skipped++; return; }
    const { data, error: claimError } = await admin.rpc("service_claim_owner_sms_alert", {
      p_organization_id: tenant.organizationId,
      p_id: job.id,
    });
    if (claimError) throw new Error("owner_alert_claim_unavailable");
    const claim = data as { status?: string; alert?: Alert } | null;
    if (claim?.status === "uncertain" && job.status === "sending") {
      summary.uncertain++;
      await notifyFailure(job, "worker_interrupted");
      await stopLaterParts(job);
      return;
    }
    if (claim?.status === "busy") {
      const predecessor = await admin.from("owner_sms_alerts")
        .select("*")
        .eq("organization_id", tenant.organizationId)
        .eq("location_id", tenant.locationId)
        .eq("source_key", job.source_key)
        .eq("recipient", job.recipient)
        .lt("part", job.part)
        .in("status", ["failed", "uncertain"])
        .order("part", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (predecessor.error) throw new Error("owner_alert_predecessor_unavailable");
      // The predecessor's failure already notifies owners. Clear all its later
      // parts together without generating one notification per blocked part.
      if (predecessor.data) await stopLaterParts(predecessor.data);
      summary.skipped++;
      return;
    }
    if (claim?.status !== "claimed" || !claim.alert) { summary.skipped++; return; }
    const alert = claim.alert;
    if (
      alert.id !== job.id ||
      alert.organization_id !== tenant.organizationId ||
      alert.location_id !== tenant.locationId ||
      !recipients.includes(alert.recipient as Recipient) ||
      !alert.body || alert.body.length > 1600
    ) throw new Error("owner_alert_claim_invalid");
    summary.claimed++;
    const callback = new URL(callbackBase);
    callback.searchParams.set("alert", alert.id);
    let outcome: Parameters<typeof saveOutcome>[1];
    try {
      const sent = await client.messages.create({
        to: configured[alert.recipient as Recipient],
        from,
        body: alert.body,
        messagingServiceSid,
        statusCallback: callback.toString(),
      });
      if (!messageSid.test(sent.sid)) {
        outcome = { status: "uncertain", error_code: "provider_response_invalid" };
      } else {
        const failed = ["failed", "undelivered", "canceled"].includes(sent.status);
        outcome = {
          status: failed ? "failed" : sent.status === "delivered" ? "delivered" : "accepted",
          provider_sid: sent.sid,
          provider_status: /^[a-z_]{1,32}$/.test(sent.status) ? sent.status : "unknown",
          ...(failed ? { error_code: safeProviderError({ code: sent.errorCode }).code } : {}),
        };
      }
    } catch (error) {
      const providerError = safeProviderError(error);
      outcome = { status: providerError.definitive ? "failed" : "uncertain", error_code: providerError.code };
    }
    let saved = false;
    try {
      saved = await saveOutcome(alert, outcome);
    } catch {
      // Never requeue a call that may already have reached Twilio. A stale
      // sending row is made uncertain by the claim RPC on the next worker run.
      outcome = { status: "uncertain", error_code: "outcome_write_unconfirmed" };
      try { saved = await saveOutcome(alert, outcome); } catch { /* Keep sending for stale-claim recovery. */ }
    }
    if (outcome.status === "failed" || outcome.status === "uncertain") {
      if (!saved) { summary.skipped++; return; }
      summary[outcome.status]++;
      await notifyFailure(alert, outcome.error_code ?? "delivery_unconfirmed");
      await stopLaterParts(alert);
    } else {
      summary.accepted++;
    }
  }

  // Each owner gets parts in order; the two independent destinations may run
  // concurrently. The RPC also enforces ordering when workers overlap.
  await Promise.all(recipients.map(async (recipient) => {
    for (const job of (jobs ?? []).filter((row) => row.recipient === recipient)) {
      try {
        await processJob(job);
      } catch {
        summary.skipped++;
        console.error("owner_sms_alert_worker_unavailable");
      }
    }
  }));
  return summary;
}
