import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function twilioConfig() {
  return {
    accountSid: required("TWILIO_ACCOUNT_SID"),
    authToken: required("TWILIO_AUTH_TOKEN"),
    phoneNumber: required("TWILIO_PHONE_NUMBER"),
    donaldNumber: required("TWILIO_FORWARD_DONALD"),
    marisNumber: required("TWILIO_FORWARD_MARIS"),
  };
}

function escapeXml(value: string) {
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

export function say(text: string) {
  return `<Say>${escapeXml(text)}</Say>`;
}

export function normalizeE164(value: string) {
  const trimmed = value.trim();
  if (!/^\+[1-9]\d{7,14}$/.test(trimmed)) throw new Error("Phone number must be E.164.");
  return trimmed;
}

export function publicRequestUrl(request: Request) {
  const explicit = process.env.TWILIO_PUBLIC_BASE_URL?.trim();
  const current = new URL(request.url);
  if (!explicit) return current.toString();
  const base = new URL(explicit.endsWith("/") ? explicit : `${explicit}/`);
  return new URL(`${current.pathname}${current.search}`, base).toString();
}

export async function readTwilioForm(request: Request) {
  const text = await request.text();
  const params = new URLSearchParams(text);
  return { params, text };
}

export function validateTwilioRequest(request: Request, params: URLSearchParams) {
  const signature = request.headers.get("x-twilio-signature")?.trim();
  if (!signature) return false;
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!token) throw new Error("TWILIO_AUTH_TOKEN is required.");
  const sorted = [...params.entries()].sort(([aKey, aValue], [bKey, bValue]) =>
    aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
  );
  const payload = publicRequestUrl(request) + sorted.map(([key, value]) => `${key}${value}`).join("");
  const expected = createHmac("sha1", token).update(payload).digest("base64");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function sendTwilioMessage(to: string, body: string) {
  const config = twilioConfig();
  const target = normalizeE164(to);
  const form = new URLSearchParams({ To: target, From: config.phoneNumber, Body: body });
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form,
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Twilio SMS failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return response.json() as Promise<{ sid: string; status: string }>;
}
