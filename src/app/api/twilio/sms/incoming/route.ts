import twilio from "twilio";
import {
  detectPrivateEventLead,
  detectReservationIntent,
  findGuestByPhone,
  logCommunicationEvent,
  notifyOwnersOfCommunication,
  recordServiceSmsConsent,
  revokeServiceSmsConsent,
} from "@/lib/communications.server";
import {
  readTwilioForm,
  validateTwilioRequest,
  xmlResponse,
} from "@/lib/twilio.server";

const stopWords = /^(stop|stopall|unsubscribe|cancel|end|revoke|optout|quit)$/i;
const startWords = /^(start|unstop)$/i;

export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params))
    return new Response("Forbidden", { status: 403 });

  const from = params.get("From") ?? "";
  const to = params.get("To") ?? "";
  const body = (params.get("Body") ?? "").trim();
  const messageSid = params.get("MessageSid") ?? "";
  const optOutType = params.get("OptOutType")?.toUpperCase() ?? null;
  const guest = from.startsWith("+") ? await findGuestByPhone(from).catch(() => null) : null;

  await logCommunicationEvent({
    eventType: "sms.inbound",
    message: "Inbound Le Yard text received.",
    metadata: {
      messageSid,
      from,
      to,
      body,
      optOutType: optOutType ?? undefined,
      guestId: guest?.id,
      guestName: guest?.display_name,
    },
  });

  if (optOutType === "STOP" || stopWords.test(body)) {
    if (from.startsWith("+"))
      await revokeServiceSmsConsent({
        phone: from,
        evidence: `Twilio inbound opt-out: ${messageSid}.`,
      }).catch(() => false);
    // Twilio's Messaging Service/default STOP handling sends the confirmation.
    return xmlResponse(new twilio.twiml.MessagingResponse().toString());
  }
  if (optOutType === "START" || startWords.test(body)) {
    if (from.startsWith("+"))
      await recordServiceSmsConsent({
        phone: from,
        evidence: `Twilio inbound opt-in: ${messageSid}.`,
      }).catch(() => false);
    return xmlResponse(new twilio.twiml.MessagingResponse().toString());
  }
  if (optOutType === "HELP")
    return xmlResponse(new twilio.twiml.MessagingResponse().toString());

  const response = new twilio.twiml.MessagingResponse();
  const eventLead = detectPrivateEventLead(body);
  if (eventLead.isLead) {
    await logCommunicationEvent({
      eventType: "lead.private_event",
      message: "Potential private-event lead detected by SMS.",
      metadata: { messageSid, from, body, signal: eventLead.matchedTerm ?? undefined },
    });
    await notifyOwnersOfCommunication({
      title: "Private-event lead",
      body: `${guest?.display_name ?? from || "A guest"}: ${body.slice(0, 220)}`,
      eventType: "private_event_lead",
    });
    response.message(
      "Thanks for reaching out to Le Yard about a private event. We have your message and will follow up. If you can, send the date, approximate guest count, and occasion.",
    );
  } else if (detectReservationIntent(body)) {
    await logCommunicationEvent({
      eventType: "reservation.intent.sms",
      message: "Reservation intent detected by SMS.",
      metadata: { messageSid, from, body, guestId: guest?.id },
    });
    response.message(
      "Happy to help with a Le Yard reservation. Send the date, preferred time, party size, your name, and email. We will use live availability when confirming the table.",
    );
  } else {
    await notifyOwnersOfCommunication({
      title: "New Le Yard text",
      body: `${guest?.display_name ?? from || "Guest"}: ${body.slice(0, 220)}`,
      eventType: "sms_inbound",
    });
  }

  return xmlResponse(response.toString());
}
