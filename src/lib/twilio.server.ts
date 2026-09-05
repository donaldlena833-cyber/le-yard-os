import "server-only";

import twilio from "twilio";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function twilioAccountSid() {
  return required("TWILIO_ACCOUNT_SID");
}

export function twilioAuthToken() {
  // Twilio uses the Auth Token to validate webhook signatures even when API
  // requests use an API key. Keep this server-only.
  return required("TWILIO_AUTH_TOKEN");
}

export function twilioPhoneNumber() {
  return required(
    process.env.TWILIO_FROM_NUMBER?.trim()
      ? "TWILIO_FROM_NUMBER"
      : "TWILIO_PHONE_NUMBER",
  );
}

export function twilioForwardNumbers() {
  return {
    donald: normalizeE164(required("TWILIO_FORWARD_DONALD")),
    maris: normalizeE164(required("TWILIO_FORWARD_MARIS")),
  };
}

export function twilioRestClient() {
  const accountSid = twilioAccountSid();
  const keySid = process.env.TWILIO_API_KEY_SID?.trim();
  const keySecret = process.env.TWILIO_API_KEY_SECRET?.trim();
  if (keySid && keySecret) return twilio(keySid, keySecret, { accountSid });
  return twilio(accountSid, twilioAuthToken());
}

export function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function xmlResponse(xml: string, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "text/xml; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(xml, { ...init, headers });
}

export function twimlVoice(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

export function twimlMessaging(body = "") {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

export function say(text: string) {
  return `<Say>${escapeXml(text)}</Say>`;
}

export function normalizeE164(value: string) {
  const trimmed = value.trim();
  if (!/^\+[1-9]\d{7,14}$/.test(trimmed))
    throw new Error("Phone number must be E.164.");
  return trimmed;
}

export function twilioAbsoluteUrl(path: string) {
  const configured =
    process.env.TWILIO_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) throw new Error("TWILIO_PUBLIC_BASE_URL is required.");
  const base = new URL(configured.endsWith("/") ? configured : `${configured}/`);
  return new URL(path.replace(/^\//, ""), base).toString();
}

export function publicRequestUrl(request: Request) {
  const current = new URL(request.url);
  const configured = process.env.TWILIO_PUBLIC_BASE_URL?.trim();
  if (!configured) return current.toString();
  const base = new URL(configured.endsWith("/") ? configured : `${configured}/`);
  return new URL(`${current.pathname}${current.search}`, base).toString();
}

export async function readTwilioForm(request: Request) {
  const text = await request.text();
  return { params: new URLSearchParams(text), text };
}

function twilioFormObject(params: URLSearchParams) {
  const output: Record<string, string | string[]> = {};
  for (const [key, value] of params.entries()) {
    const current = output[key];
    if (current === undefined) output[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else output[key] = [current, value];
  }
  return output;
}

export function validateTwilioRequest(
  request: Request,
  params: URLSearchParams,
) {
  const signature = request.headers.get("x-twilio-signature")?.trim();
  if (!signature) return false;
  return twilio.validateRequest(
    twilioAuthToken(),
    signature,
    publicRequestUrl(request),
    twilioFormObject(params),
  );
}

export function requireValidTwilioRequest(
  request: Request,
  params: URLSearchParams,
) {
  if (!validateTwilioRequest(request, params))
    throw new Response("Forbidden", { status: 403 });
}

export async function sendTwilioMessage(to: string, body: string) {
  const target = normalizeE164(to);
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  return twilioRestClient().messages.create({
    to: target,
    body,
    ...(messagingServiceSid
      ? { messagingServiceSid }
      : { from: twilioPhoneNumber() }),
    statusCallback: twilioAbsoluteUrl("/api/twilio/sms/status"),
  });
}

export async function createTwilioCall(input: {
  to: string;
  url: string;
  statusCallback?: string;
}) {
  return twilioRestClient().calls.create({
    to: normalizeE164(input.to),
    from: twilioPhoneNumber(),
    url: input.url,
    method: "POST",
    statusCallback:
      input.statusCallback ?? twilioAbsoluteUrl("/api/twilio/voice/status"),
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
  });
}
