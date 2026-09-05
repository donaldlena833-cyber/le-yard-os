import twilio from "twilio";
import { detectPrivateEventLead, detectReservationIntent, findGuestByPhone, logCommunicationEvent,
  notifyOwnersOfCommunication, recordServiceSmsConsent, revokeServiceSmsConsent } from "@/lib/communications.server";
import { readTwilioForm, twilioSmsEnabled, twilioPhoneNumber, validateTwilioRequest, xmlResponse } from "@/lib/twilio.server";

const stopWords = /^(stop|stopall|unsubscribe|cancel|end|revoke|optout|quit)$/i;
const startWords = /^(start|unstop)$/i;
export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params)) return new Response("Forbidden", { status: 403 });
  const from = params.get("From") ?? "";
  const to = params.get("To") ?? "";
  const body = (params.get("Body") ?? "").trim();
  const messageSid = params.get("MessageSid") ?? "";
  if (to !== twilioPhoneNumber() || !/^(SM|MM)[0-9a-f]{32}$/i.test(messageSid)) return new Response("Forbidden", { status: 403 });
  const mediaCount = Math.min(Math.max(Math.floor(Number(params.get("NumMedia") ?? 0) || 0), 0), 10);
  const media = Array.from({ length: mediaCount }, (_, i) => ({ url: params.get(`MediaUrl${i}`) ?? "", contentType: params.get(`MediaContentType${i}`) ?? "" }));
  const optOutType = params.get("OptOutType")?.toUpperCase() ?? null;
  const guest = from.startsWith("+") ? await findGuestByPhone(from).catch(() => null) : null;
  const senderLabel = guest?.display_name || from || "Guest";
  try {
    await logCommunicationEvent({ eventType: "sms.inbound", message: "Inbound Le Yard text received.",
      metadata: { messageSid, from, to, body, media, mediaCount, optOutType: optOutType ?? undefined, guestId: guest?.id, guestName: guest?.display_name } }, { required: true });
    if (optOutType === "STOP" || stopWords.test(body)) {
      if (from.startsWith("+")) await revokeServiceSmsConsent({ phone: from, evidence: `Twilio inbound opt-out: ${messageSid}.` });
      return xmlResponse(new twilio.twiml.MessagingResponse().toString());
    }
    if (optOutType === "START" || startWords.test(body)) {
      if (from.startsWith("+")) await recordServiceSmsConsent({ phone: from, evidence: `Twilio inbound opt-in: ${messageSid}.` });
      return xmlResponse(new twilio.twiml.MessagingResponse().toString());
    }
  } catch { return new Response("Temporary receipt failure", { status: 503 }); }
  // Advanced Opt-Out sends its own confirmations. Do not duplicate them.
  if (optOutType === "HELP") return xmlResponse(new twilio.twiml.MessagingResponse().toString());
  const response = new twilio.twiml.MessagingResponse();
  if (!twilioSmsEnabled()) return xmlResponse(response.toString());
  if (/^help$/i.test(body)) {
    response.message("Le Yard Guest Care: For help, contact office@leyardny.com or call (332) 877-9035. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out.");
    return xmlResponse(response.toString());
  }
  const eventLead = detectPrivateEventLead(body);
  if (eventLead.isLead) {
    await logCommunicationEvent({ eventType: "lead.private_event", message: "Potential private-event lead detected by SMS.", metadata: { messageSid, from, body, signal: eventLead.matchedTerm ?? undefined } });
    await notifyOwnersOfCommunication({ title: "Private-event lead", body: `${senderLabel}: ${body.slice(0, 220)}`, eventType: "private_event_lead" });
    response.message("Le Yard: Your event inquiry has been received. Please send the date, approximate guest count, and occasion. This is not a confirmed booking. Reply STOP to opt out.");
  } else if (detectReservationIntent(body)) {
    await logCommunicationEvent({ eventType: "reservation.intent.sms", message: "Reservation intent detected by SMS.", metadata: { messageSid, from, body, guestId: guest?.id } });
    await notifyOwnersOfCommunication({ title: "Reservation inquiry", body: `${senderLabel}: ${body.slice(0, 220)}`, eventType: "sms_inbound" });
    response.message("Le Yard: We received your reservation question. Please send your preferred date, time, and party size. A table is not booked until explicitly confirmed. Reply STOP to opt out.");
  } else {
    await notifyOwnersOfCommunication({ title: "New Le Yard text", body: `${senderLabel}: ${body.slice(0, 220)}`, eventType: "sms_inbound" });
  }
  return xmlResponse(response.toString());
}
