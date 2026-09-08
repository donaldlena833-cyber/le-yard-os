import "server-only";
import { handoffNotice } from "@/lib/communication-groups";
import { createHash } from "node:crypto";
import {
  resolveLeYardTenant,
  notifyOwnersOfCommunication,
} from "@/lib/communications.server";
import {
  communicationThreadSource,
  setCommunicationThreadMode,
} from "@/lib/communication-groups.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTwilioMessage } from "@/lib/twilio.server";

export async function performCommunicationHandoff(
  input: { requestId: string; phone: string; reason: string; summary: string },
  sourceOverride?: { sid: string; audience: string },
) {
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
    const source =
      sourceOverride ?? (await communicationThreadSource(input.phone));
    const group = source?.audience === "team" ? "team" : "clients";
    const item = await admin.from("communication_cases").insert({
      id: input.requestId,
      organization_id: tenant.organizationId,
      location_id: tenant.locationId,
      kind: "ticket",
      title: input.reason,
      body: input.summary,
      phone: input.phone,
      source_sid: source?.sid ?? null,
    });
    if (item.error) throw item.error;
    await notifyOwnersOfCommunication({
      phone: input.phone,
      title:
        group === "team"
          ? "Team request needs a human"
          : "Client needs a human",
      body: input.reason,
      eventType: "sms_human_handoff",
      actionUrl: `/messages?group=${group}&phone=${encodeURIComponent(input.phone)}`,
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
