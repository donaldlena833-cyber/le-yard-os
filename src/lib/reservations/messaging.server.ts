import "server-only";

import { createReservationLinkToken } from "./link-token.server";
import { reservationSmsDeliveryEnabled } from "./delivery-policy.server";
import { reservationProviderTimeoutMs } from "./outbox-policy";
import { canonicalReservationPublicSiteOrigin } from "./public-origin.server";

export type ReservationDeliveryState = "sent" | "failed" | "not_configured";
export type ReservationDeliveryResult = {
  state: ReservationDeliveryState;
  providerMessageId: string | null;
};

export function isReservationMessageChannelBound(input: {
  channel: unknown;
  templateKey: unknown;
  templateData: unknown;
}) {
  if (input.channel !== "email" && input.channel !== "sms") return false;
  if (
    !input.templateData ||
    typeof input.templateData !== "object" ||
    Array.isArray(input.templateData)
  )
    return (
      input.templateKey !== "reservation_verify" &&
      input.templateKey !== "reservation_confirmed"
    );
  const data = input.templateData as Record<string, unknown>;
  if (
    data.channel !== undefined &&
    data.channel !== null &&
    data.channel !== input.channel
  )
    return false;
  if (input.templateKey === "reservation_verify")
    return (
      data.channel === input.channel && data.purpose === "reservation_verify"
    );
  if (input.templateKey === "reservation_confirmed")
    return (
      data.channel === input.channel &&
      data.purpose === "reservation_manage_exchange"
    );
  return true;
}

async function providerDeliveryResult(response: Response) {
  if (!response.ok)
    return { state: "failed", providerMessageId: null } as const;
  let providerMessageId: string | null = null;
  try {
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength <= 8_192) {
      const payload = JSON.parse(body) as { id?: unknown; sid?: unknown };
      const candidate = payload.id ?? payload.sid;
      if (typeof candidate === "string" && candidate.length <= 500)
        providerMessageId = candidate;
    }
  } catch {
    // A successful provider status remains authoritative if its optional
    // response identifier is absent or malformed.
  }
  return { state: "sent", providerMessageId } as const;
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ]!,
  );
}

function displayDateTime(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export async function sendReservationOutboxMessage(input: {
  messageId: string;
  organizationId: string;
  locationId: string;
  reservationId: string | null;
  bookingHoldId: string | null;
  channel: "email" | "sms";
  templateKey:
    | "reservation_verify"
    | "reservation_confirmed"
    | "reservation_cancelled"
    | "reservation_modified"
    | "reservation_reminder_24h"
    | "reservation_reminder_2h"
    | "waitlist_table_ready";
  guestName: string;
  email: string | null;
  phone: string | null;
  publicCode: string | null;
  reservedAt: string | null;
  offerExpiresAt: string | null;
  holdExpiresAt: string | null;
  messageCreatedAt: string;
}): Promise<ReservationDeliveryResult> {
  const scheduled = displayDateTime(input.reservedAt);
  const offerDeadline = displayDateTime(input.offerExpiresAt);
  const siteUrl = canonicalReservationPublicSiteOrigin();
  let action: { label: string; url: string } | null = null;
  if (
    (input.templateKey === "reservation_verify" ||
      input.templateKey === "reservation_confirmed" ||
      input.templateKey === "reservation_modified") &&
    (!siteUrl ||
      (input.templateKey === "reservation_verify"
        ? !input.bookingHoldId
        : !input.reservationId))
  )
    return { state: "not_configured", providerMessageId: null };
  if (input.templateKey === "reservation_verify" && !input.holdExpiresAt)
    return { state: "failed", providerMessageId: null };
  if (
    input.templateKey === "reservation_verify" &&
    siteUrl &&
    input.bookingHoldId &&
    input.holdExpiresAt
  ) {
    const token = createReservationLinkToken({
      purpose: "verify",
      organizationId: input.organizationId,
      locationId: input.locationId,
      subjectId: input.bookingHoldId,
      expiresAt: input.holdExpiresAt,
      verifiedChannel: input.channel,
    });
    action = {
      label: "Confirm reservation",
      url: `${siteUrl}/api/reservations/verify/exchange?token=${encodeURIComponent(token)}`,
    };
  }
  if (
    (input.templateKey === "reservation_confirmed" ||
      input.templateKey === "reservation_modified") &&
    siteUrl &&
    input.reservationId
  ) {
    const expiresAt = new Date(
      new Date(input.messageCreatedAt).valueOf() + 48 * 60 * 60 * 1_000,
    ).toISOString();
    const token = createReservationLinkToken({
      purpose: "manage_exchange",
      organizationId: input.organizationId,
      locationId: input.locationId,
      subjectId: input.reservationId,
      expiresAt,
    });
    action = {
      label: "View or manage reservation",
      url: `${siteUrl}/api/reservations/manage/link?token=${encodeURIComponent(token)}`,
    };
  }
  const copy =
    input.templateKey === "reservation_verify"
      ? {
          subject: "Confirm your table at Le Yard",
          headline: "Your table is almost yours.",
          body: `${input.publicCode ? `Reservation ${input.publicCode}` : "Your table"} is being held briefly. Use the secure link to confirm before the hold expires.`,
          sms: `Le Yard: confirm ${input.publicCode ? `reservation ${input.publicCode}` : "your table"}${action ? `: ${action.url}` : "."}`,
        }
      : input.templateKey === "reservation_confirmed"
        ? {
            subject: "Your Le Yard reservation is confirmed",
            headline: "We’ll see you at Le Yard.",
            body: `${input.publicCode ? `Reservation ${input.publicCode}` : "Your reservation"}${scheduled ? ` is set for ${scheduled}` : " is confirmed"}. Use the secure link to view or make changes.`,
            sms: `Le Yard: ${input.publicCode ? `reservation ${input.publicCode}` : "your reservation"} is confirmed${action ? `. Manage it securely: ${action.url}` : "."}`,
          }
        : input.templateKey === "reservation_reminder_24h" ||
    input.templateKey === "reservation_reminder_2h"
      ? {
          subject: "A reminder for your Le Yard reservation",
          headline:
            input.templateKey === "reservation_reminder_24h"
              ? "Your table is waiting tomorrow."
              : "We’ll see you soon.",
          body: `${input.publicCode ? `Reservation ${input.publicCode}` : "Your reservation"}${scheduled ? ` is set for ${scheduled}` : " is coming up"}. We look forward to welcoming you.`,
          sms: `Le Yard reminder: ${input.publicCode ? `reservation ${input.publicCode}` : "your reservation"}${scheduled ? ` is set for ${scheduled}` : " is coming up"}.`,
        }
      : input.templateKey === "waitlist_table_ready"
        ? {
            subject: "Your table at Le Yard is ready",
            headline: "Your table is ready.",
            body: offerDeadline
              ? `Please check in by ${offerDeadline}. If your plans changed, call the restaurant so we can offer the table to the next party.`
              : "Please come to the host stand within 15 minutes. If your plans changed, call the restaurant so we can offer the table to the next party.",
            sms: offerDeadline
              ? `Le Yard: your table is ready. Please check in by ${offerDeadline}.`
              : "Le Yard: your table is ready. Please check in with the host within 15 minutes.",
          }
        : input.templateKey === "reservation_modified"
          ? {
              subject: "Your Le Yard reservation was updated",
              headline: "Your reservation was updated.",
              body: `${input.publicCode ? `Reservation ${input.publicCode}` : "Your reservation"}${scheduled ? ` is now set for ${scheduled}` : " has new details"}. Use the secure link to review or manage it.`,
              sms: `Le Yard: ${input.publicCode ? `reservation ${input.publicCode}` : "your reservation"}${scheduled ? ` is now set for ${scheduled}` : " was updated"}${action ? `. Manage it securely: ${action.url}` : "."}`,
            }
          : {
              subject: "Your Le Yard reservation was cancelled",
              headline: "Your reservation is cancelled.",
              body: `${input.publicCode ? `Reservation ${input.publicCode}` : "Your reservation"} has been cancelled. We hope to welcome you another evening.`,
              sms: `Le Yard: ${input.publicCode ? `reservation ${input.publicCode}` : "your reservation"} has been cancelled.`,
            };

  if (input.channel === "email") {
    if (!input.email) return { state: "failed", providerMessageId: null };
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.RESERVATION_EMAIL_FROM?.trim();
    if (!apiKey || !from)
      return { state: "not_configured", providerMessageId: null };
    return fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `reservation-message-${input.messageId}`,
      },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: copy.subject,
        html: `<div style="font-family:Georgia,serif;color:#171713;line-height:1.55"><p style="font:700 11px Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#9a722e">Le Yard · Guest services</p><h1 style="font-size:34px;font-weight:500">${escapeHtml(copy.headline)}</h1><p>Hello ${escapeHtml(input.guestName)},</p><p>${escapeHtml(copy.body)}</p>${action ? `<p><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#171713;color:#fff4df;padding:14px 20px;text-decoration:none">${escapeHtml(action.label)}</a></p>` : ""}<p style="font:12px Arial,sans-serif;color:#69675f">If you did not request this reservation, you can ignore this message.</p></div>`,
      }),
      signal: AbortSignal.timeout(reservationProviderTimeoutMs),
    })
      .then(providerDeliveryResult)
      .catch(() => ({ state: "failed", providerMessageId: null }));
  }

  if (!reservationSmsDeliveryEnabled())
    return { state: "not_configured", providerMessageId: null };
  if (!input.phone) return { state: "failed", providerMessageId: null };
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  if (!accountSid || !authToken || !from)
    return { state: "not_configured", providerMessageId: null };
  return fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: input.phone,
        From: from,
        Body: copy.sms,
      }),
      signal: AbortSignal.timeout(reservationProviderTimeoutMs),
    },
  )
    .then(providerDeliveryResult)
    .catch(() => ({ state: "failed", providerMessageId: null }));
}
