import twilio from "twilio";
import { z } from "zod";
import { validateAgentToolSecret } from "@/lib/elevenlabs.server";
import {
  logCommunicationEvent,
  notifyOwnersOfCommunication,
} from "@/lib/communications.server";
import {
  twilioAbsoluteUrl,
  twilioForwardNumbers,
  twilioRestClient,
} from "@/lib/twilio.server";

const schema = z.object({
  callSid: z.string().regex(/^CA[0-9a-fA-F]{32}$/),
  reason: z.string().trim().min(2).max(80),
  summary: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  if (!validateAgentToolSecret(request))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({
    answerOnBridge: true,
    timeout: 24,
    action: twilioAbsoluteUrl("/api/twilio/voice/result"),
    method: "POST",
  });
  for (const [staff, phone] of Object.entries(twilioForwardNumbers())) {
    const screen = new URL(twilioAbsoluteUrl("/api/twilio/voice/screen"));
    screen.searchParams.set("staff", staff);
    screen.searchParams.set("context", `AI transfer: ${input.reason}`);
    dial.number({ url: screen.toString(), method: "POST" }, phone);
  }

  await twilioRestClient().calls(input.callSid).update({
    twiml: response.toString(),
  });
  await logCommunicationEvent({
    eventType: "voice.ai.human_transfer",
    message: `AI transferred live call to human ring group: ${input.reason}.`,
    metadata: {
      callSid: input.callSid,
      reason: input.reason,
      summary: input.summary,
    },
  });
  if (input.summary) {
    await notifyOwnersOfCommunication({
      title: `AI handoff: ${input.reason}`,
      body: input.summary,
      eventType: "voice_ai_handoff",
    });
  }
  return Response.json({ ok: true });
}
