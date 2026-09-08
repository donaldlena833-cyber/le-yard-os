import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  hasServiceSmsConsent,
  notifyOwnersOfCommunication,
  resolveLeYardTenant,
} from "@/lib/communications.server";
import {
  communicationThreadMode,
  setCommunicationThreadMode,
} from "@/lib/communication-groups.server";
import { performCommunicationHandoff } from "@/lib/communication-handoff.server";
import { communicationsAvailability } from "@/lib/communications-reservations.server";
import { classifySms } from "@/lib/gemini-sms.server";
import {
  planSmsAiReply,
  smsAiWeek,
  smsPilotContact,
  SMS_AI_MODEL,
  SMS_AI_WEEKLY_MICRO_USD,
} from "@/lib/sms-ai-policy";
import {
  sendTwilioMessage,
  twilioAccountSid,
  twilioAuthToken,
  twilioPhoneNumber,
  twilioRestClient,
  twilioSmsEnabled,
} from "@/lib/twilio.server";
import type { Database, Json } from "@/types/database.generated";

type Message = Database["public"]["Tables"]["communication_messages"]["Row"];
function handoffId(sid: string) {
  const hash = createHash("sha256").update(`sms-ai-pilot:${sid}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
async function imageForMessage(message: Message) {
  if (!message.media_count) return undefined;
  if (message.media_count !== 1) throw new Error("multiple_images_need_review");
  const client = twilioRestClient();
  const provider = await client.messages(message.sid).fetch();
  if (
    provider.from !== message.from_number ||
    provider.to !== twilioPhoneNumber()
  )
    throw new Error("media_scope_mismatch");
  const media = await client.messages(message.sid).media.list({ limit: 2 });
  if (
    media.length !== 1 ||
    !/^image\/(jpeg|png|webp)$/.test(media[0].contentType)
  )
    throw new Error("unsupported_media");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid()}/Messages/${message.sid}/Media/${media[0].sid}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${twilioAccountSid()}:${twilioAuthToken()}`).toString("base64")}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(7000),
  });
  if (
    !response.ok ||
    Number(response.headers.get("content-length")) > 4_000_000 ||
    !response.body
  )
    throw new Error("media_unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.length;
    if (bytes > 4_000_000) {
      await reader.cancel();
      throw new Error("media_too_large");
    }
    chunks.push(next.value);
  }
  const compact = await sharp(Buffer.concat(chunks), {
    limitInputPixels: 20_000_000,
  })
    .rotate()
    .resize({
      width: 768,
      height: 768,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 75 })
    .toBuffer();
  return { mimeType: "image/jpeg", data: compact.toString("base64") };
}
export async function enqueueSmsPilot(sid: string) {
  const tenant = await resolveLeYardTenant();
  const { error } = await createAdminClient().rpc(
    "service_enqueue_sms_ai_run",
    {
      p_organization_id: tenant.organizationId,
      p_location_id: tenant.locationId,
      p_source_sid: sid,
    },
  );
  if (error) throw new Error("pilot_queue_unavailable");
}
async function handoff(message: Message, reason: string, summary: string) {
  if (!smsPilotContact(message.from_number)) throw new Error("pilot_expired");
  if (
    !(await hasServiceSmsConsent(message.from_number)) ||
    (await communicationThreadMode(message.from_number)) === "human"
  )
    return null;
  const response = await performCommunicationHandoff(
    {
      requestId: handoffId(message.sid),
      phone: message.from_number,
      reason: `AI pilot: ${reason}`.slice(0, 160),
      summary,
    },
    { sid: message.sid, audience: message.audience },
  );
  if (!response.ok) throw new Error("handoff_unconfirmed");
  const result = await response.json();
  return result.noticeSid as string | null;
}
async function processJob(organizationId: string, sid: string) {
  const admin = createAdminClient();
  const { data: message, error: messageError } = await admin
    .from("communication_messages")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("sid", sid)
    .single();
  if (messageError || !message) throw new Error("pilot_message_unavailable");
  if (!smsPilotContact(message.from_number) || !twilioSmsEnabled()) {
    const { error } = await admin
      .from("sms_ai_runs")
      .update({
        status: "held",
        error_code: "pilot_disabled",
        completed_at: new Date().toISOString(),
      })
      .eq("organization_id", organizationId)
      .eq("source_sid", sid)
      .eq("status", "queued");
    if (error) throw new Error("pilot_job_unavailable");
    return;
  }
  const { data: claim, error: claimError } = await admin.rpc(
    "service_claim_sms_ai_run",
    { p_organization_id: organizationId, p_source_sid: sid },
  );
  if (claimError) throw new Error("pilot_claim_unavailable");
  const status = (claim as { status: string })?.status;
  if (status === "held") {
    await notifyOwnersOfCommunication({
      phone: message.from_number,
      title: "AI pilot · human handling",
      body: "A new message is waiting in the Team conversation.",
      eventType: "sms_human_reply",
      actionUrl: "/messages?group=team",
    });
    return;
  }
  if (status === "budget") {
    await handoff(
      message,
      "Weekly AI budget reached",
      "The pilot has reached its weekly reserved model budget. Please reply through Groups.",
    );
    return;
  }
  if (status !== "claimed") return;
  let outcome: Partial<Database["public"]["Tables"]["sms_ai_runs"]["Update"]> =
    {};
  let sendAttempted = false;
  try {
    if (!(await hasServiceSmsConsent(message.from_number))) {
      outcome = { status: "held", error_code: "opted_out" };
      return;
    }
    const { data: history, error } = await admin
      .from("communication_messages")
      .select("direction,body,sent_at,sid")
      .eq("organization_id", organizationId)
      .eq("location_id", message.location_id)
      .eq("phone", message.from_number)
      .gte("sent_at", process.env.SMS_AI_PILOT_STARTED_AT!)
      .lte("sent_at", message.sent_at)
      .order("sent_at", { ascending: false })
      .order("sid", { ascending: false })
      .limit(8);
    if (error) throw new Error("history_unavailable");
    const messages = (history ?? [])
      .reverse()
      .filter((m) => m.sid !== sid)
      .map((m) => ({ direction: m.direction, body: m.body.slice(0, 700) }));
    messages.push({ direction: "inbound", body: message.body.slice(0, 2000) });
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const result = await classifySms({
      today,
      messages,
      image: await imageForMessage(message),
    });
    outcome = {
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      reserved_micro_usd: result.cost,
      latency_ms: result.latencyMs,
      decision: result.decision as Json,
    };
    let plan = planSmsAiReply(
      result.decision,
      today,
      messages.filter(
        (m) =>
          m.direction === "outbound" &&
          m.body.includes("Could you describe what you need"),
      ).length,
    );
    if (plan.type === "availability") {
      try {
        const availability = await communicationsAvailability({
          date: plan.date,
          partySize: plan.partySize,
        });
        const times = [
          ...new Set(availability.slots.map((s) => s.timeLabel)),
        ].slice(0, 4);
        plan = {
          type: "reply",
          text: times.length
            ? `Le Yard AI assistant: Current availability for ${plan.partySize} on ${plan.date}: ${times.join(", ")} (New York time). Nothing is booked. Which time would you like our team to confirm?`
            : `Le Yard AI assistant: I found no available online times for ${plan.partySize} on ${plan.date}. Nothing is booked. Reply "human" if you'd like the team to help.`,
        };
      } catch {
        plan = {
          type: "handoff",
          reason: "Availability needs human verification",
        };
      }
    }
    // Recheck after model/tool latency, immediately before any outgoing action.
    if (
      !smsPilotContact(message.from_number) ||
      !twilioSmsEnabled() ||
      !(await hasServiceSmsConsent(message.from_number)) ||
      (await communicationThreadMode(message.from_number)) === "human"
    ) {
      outcome = {
        ...outcome,
        status: "held",
        error_code: "send_guard_changed",
      };
      return;
    }
    sendAttempted = true;
    const replySid =
      plan.type === "handoff"
        ? await handoff(
            message,
            plan.reason,
            result.decision.summary +
              (result.decision.photoDescription
                ? `\nPhoto: ${result.decision.photoDescription}`
                : ""),
          )
        : (await sendTwilioMessage(message.from_number, plan.text)).sid;
    outcome = { ...outcome, status: "completed", reply_sid: replySid };
  } catch {
    outcome = {
      ...outcome,
      status: "failed",
      error_code: sendAttempted
        ? "send_unconfirmed"
        : "pilot_processing_failed",
    };
    if (!sendAttempted && smsPilotContact(message.from_number)) {
      try {
        outcome.reply_sid = await handoff(
          message,
          "Request needs review",
          "The AI pilot could not safely complete this request. Review the original message and attachments in Groups.",
        );
      } catch {
        await setCommunicationThreadMode(
          message.from_number,
          "human",
          "AI pilot result needs review",
        );
      }
    } else if (smsPilotContact(message.from_number)) {
      await setCommunicationThreadMode(
        message.from_number,
        "human",
        "AI pilot send result is unconfirmed; inspect history before retrying",
      );
      await notifyOwnersOfCommunication({
        phone: message.from_number,
        title: "AI pilot result needs review",
        body: "A send could not be confirmed. Check the transcript before replying.",
        eventType: "sms_ai_uncertain",
        actionUrl: "/messages?group=team",
      });
    }
  } finally {
    const { error } = await admin
      .from("sms_ai_runs")
      .update({ ...outcome, completed_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("source_sid", sid)
      .eq("status", "processing");
    if (error) console.error("sms_ai_result_persistence_failed");
  }
}
export async function processSmsPilotQueue() {
  const tenant = await resolveLeYardTenant();
  try {
    // Bounded work fits the callback's post-response execution window. Queued
    // work survives interruptions and can be resumed from the owner pilot card.
    for (let i = 0; i < 3; i++) {
      const { data, error } = await createAdminClient()
        .from("sms_ai_runs")
        .select("source_sid")
        .eq("organization_id", tenant.organizationId)
        .eq("location_id", tenant.locationId)
        .or(
          `status.eq.queued,and(status.eq.processing,started_at.lt.${new Date(Date.now() - 90_000).toISOString()})`,
        )
        .order("created_at")
        .order("source_sid")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) break;
      await processJob(tenant.organizationId, data.source_sid);
    }
  } catch {
    console.error("sms_ai_worker_unavailable");
  }
}
export async function smsPilotStatus() {
  const tenant = await resolveLeYardTenant();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("sms_ai_runs")
    .select(
      "status,reserved_micro_usd,week_start,model,latency_ms,input_tokens,output_tokens,error_code,created_at,started_at",
    )
    .eq("organization_id", tenant.organizationId)
    .eq("location_id", tenant.locationId)
    .or(`week_start.eq.${smsAiWeek()},created_at.gte.${smsAiWeek()}T00:00:00Z,status.eq.queued,status.eq.processing`)
    .order("created_at", { ascending: false })
    .limit(20000);
  if (error || !data || data.length >= 20000)
    throw new Error("pilot_status_unavailable");
  const contacts = await Promise.all(
    (["Donald", "Maris"] as const).map(async (name) => {
      const phone =
        process.env[`TWILIO_FORWARD_${name.toUpperCase()}`]?.trim() ?? "";
      return {
        name,
        enabled: smsPilotContact(phone),
        mode: phone ? await communicationThreadMode(phone) : null,
      };
    }),
  );
  return {
    enabled: contacts.some((contact) => contact.enabled),
    model: SMS_AI_MODEL,
    until: process.env.SMS_AI_PILOT_UNTIL ?? null,
    contacts,
    budgetUsd: SMS_AI_WEEKLY_MICRO_USD / 1_000_000,
    reservedUsd:
      data
        .filter((r) => r.week_start === smsAiWeek())
        .reduce((sum, r) => sum + r.reserved_micro_usd, 0) / 1_000_000,
    queued: data.filter(
      (r) =>
        r.status === "queued" ||
        (r.status === "processing" &&
          r.started_at &&
          Date.parse(r.started_at) < Date.now() - 90_000),
    ).length,
    review: data.filter((r) => r.status === "failed" || r.status === "held")
      .length,
    recent: data.slice(0, 5),
  };
}
