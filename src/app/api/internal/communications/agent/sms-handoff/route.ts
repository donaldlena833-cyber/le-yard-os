import { handoffNotice } from "@/lib/communication-groups";
import { createHash } from "node:crypto";
import { z } from "zod";
import { validateAgentToolSecret } from "@/lib/elevenlabs.server";
import {
  resolveLeYardTenant,
  notifyOwnersOfCommunication,
} from "@/lib/communications.server";
import { setCommunicationThreadMode } from "@/lib/communication-groups.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTwilioMessage, twilioPhoneNumber } from "@/lib/twilio.server";
const schema = z
  .object({
    requestId: z.string().uuid(),
    phone: z.string().regex(/^\+1[2-9]\d{9}$/),
    reason: z.string().trim().min(2).max(160),
    summary: z.string().trim().max(10000),
  })
  .strict();
export async function POST(request: Request) {
  if (!validateAgentToolSecret(request))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.phone === twilioPhoneNumber())
    return Response.json({ error: "Invalid handoff" }, { status: 400 });
  const input = parsed.data;
  try {
    const tenant = await resolveLeYardTenant();
    const admin = createAdminClient();
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const bucket = admin.storage.from("phone-outbox");
    const path = `${tenant.organizationId}/handoff-${input.requestId}.json`;
    const prior = await bucket.download(path);
    if (prior.data) {
      const state = JSON.parse(await prior.data.text());
      return Response.json(
        state.fingerprint === fingerprint
          ? {
              status: state.status,
              noticeSid: state.sid ?? null,
              replayed: true,
            }
          : { error: "Request ID already used" },
        { status: state.fingerprint === fingerprint ? 200 : 409 },
      );
    }
    if (prior.error && !/not found|does not exist/i.test(prior.error.message))
      throw prior.error;
    // Pause before claiming or sending; a partial handoff stays with a human.
    await setCommunicationThreadMode(input.phone, "human", input.reason);
    const claimed = await bucket.upload(
      path,
      JSON.stringify({ fingerprint, status: "pending" }),
      { contentType: "application/json", upsert: false },
    );
    if (claimed.error)
      return Response.json(
        {
          error: "Handoff is already being processed. Refresh before retrying.",
        },
        { status: 409 },
      );
    const item = await admin.from("communication_cases").insert({
      id: input.requestId,
      organization_id: tenant.organizationId,
      location_id: tenant.locationId,
      kind: "ticket",
      title: input.reason,
      body: input.summary,
      phone: input.phone,
    });
    if (item.error) throw item.error;
    await notifyOwnersOfCommunication({
      title: "Client needs a human",
      body: input.reason,
      eventType: "sms_human_handoff",
      actionUrl: "/messages?group=clients",
      required: true,
    });
    try {
      const sent = await sendTwilioMessage(input.phone, handoffNotice, {
        handoffNotice: true,
      });
      await bucket.upload(
        path,
        JSON.stringify({ fingerprint, status: sent.status, sid: sent.sid }),
        { contentType: "application/json", upsert: true },
      );
      return Response.json(
        { status: sent.status, noticeSid: sent.sid, mode: "human" },
        { status: 201 },
      );
    } catch {
      await bucket.upload(
        path,
        JSON.stringify({ fingerprint, status: "uncertain" }),
        { contentType: "application/json", upsert: true },
      );
      return Response.json(
        {
          error:
            "Human handoff saved; client notice is unconfirmed. Check the transcript before retrying.",
          mode: "human",
          status: "uncertain",
        },
        { status: 503 },
      );
    }
  } catch {
    return Response.json(
      { error: "Handoff is incomplete. Refresh Groups before retrying." },
      { status: 503 },
    );
  }
}
