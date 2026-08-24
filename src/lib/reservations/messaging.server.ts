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
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return null;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(date);
}

export function reservationEmailSender(configuredFrom: string) {
  const match = configuredFrom.match(/^(?:(.*?)\s*<)?\s*([^<>\s]+@[^<>\s]+)\s*>?$/);
  if (!match) return configuredFrom;
  const address = match[2]!.toLowerCase();
  if (address.split("@", 1)[0] !== "reservations") return configuredFrom;
  return `Le Yard Reservations Team <${address}>`;
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
          body: "Your table is being held briefly. Use the secure link to confirm before the hold expires.",
          sms: `Le Yard: confirm your table${action ? `: ${action.url}` : "."}`,
        }
      : input.templateKey === "reservation_confirmed"
        ? {
            subject: "Your table at Le Yard is booked",
            headline: "Your table is booked.",
            body: scheduled
              ? `We’re looking forward to welcoming you on ${scheduled}.`
              : "We’re looking forward to welcoming you.",
            sms: `Le Yard: your table is booked${scheduled ? ` for ${scheduled}` : ""}${action ? `. Manage it securely: ${action.url}` : "."}`,
          }
        : input.templateKey === "reservation_reminder_24h" ||
            input.templateKey === "reservation_reminder_2h"
          ? {
              subject: "A reminder for your Le Yard reservation",
              headline:
                input.templateKey === "reservation_reminder_24h"
                  ? "Your table is waiting tomorrow."
                  : "We’ll see you soon.",
              body: `Your reservation${scheduled ? ` is set for ${scheduled}` : " is coming up"}. We look forward to welcoming you.`,
              sms: `Le Yard reminder: your reservation${scheduled ? ` is set for ${scheduled}` : " is coming up"}.`,
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
                  body: `Your reservation${scheduled ? ` is now set for ${scheduled}` : " has new details"}. Use the secure link to review or manage it.`,
                  sms: `Le Yard: your reservation${scheduled ? ` is now set for ${scheduled}` : " was updated"}${action ? `. Manage it securely: ${action.url}` : "."}`,
                }
              : {
                  subject: "Your Le Yard reservation was cancelled",
                  headline: "Your reservation is cancelled.",
                  body: "Your reservation has been cancelled. We hope to welcome you another evening.",
                  sms: "Le Yard: your reservation has been cancelled.",
                };

  if (input.channel === "email") {
    if (!input.email) return { state: "failed", providerMessageId: null };
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const configuredFrom = process.env.RESERVATION_EMAIL_FROM?.trim();
    const replyTo = process.env.RESERVATION_EMAIL_REPLY_TO?.trim();
    if (!apiKey || !configuredFrom)
      return { state: "not_configured", providerMessageId: null };
    const from = reservationEmailSender(configuredFrom);
    return fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `reservation-message-${input.messageId}`,
      },
      body: JSON.stringify({
        from,
        ...(replyTo ? { reply_to: replyTo } : {}),
        to: [input.email],
        subject: copy.subject,
        html: `<!doctype html><html><body style="margin:0;background:#191b18;padding:32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fffdf7;border-radius:18px;overflow:hidden"><tr><td style="padding:28px 32px 22px;border-bottom:1px solid #e4dfd2"><p style="margin:0;font:700 12px Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#8b6731">Le Yard</p></td></tr><tr><td style="padding:36px 32px 32px;color:#171713;font-family:Arial,sans-serif"><p style="margin:0 0 12px;font-size:15px;color:#625f58">Hello ${escapeHtml(input.guestName)},</p><h1 style="margin:0;font-family:Georgia,serif;font-size:38px;line-height:1.08;font-weight:500;letter-spacing:-.02em">${escapeHtml(copy.headline)}</h1><p style="margin:20px 0 0;font-size:16px;line-height:1.65;color:#4f4c45">${escapeHtml(copy.body)}</p>${scheduled ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:26px;background:#f4f0e6;border-radius:12px"><tr><td style="padding:18px 20px"><p style="margin:0 0 5px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#837d70">Date &amp; time</p><p style="margin:0;font-family:Georgia,serif;font-size:20px;color:#171713">${escapeHtml(scheduled)}</p></td></tr></table>` : ""}${action ? `<p style="margin:28px 0 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;border-radius:10px;background:#171713;color:#fffdf7;padding:14px 20px;font-size:14px;font-weight:700;text-decoration:none">${escapeHtml(action.label)}</a></p>` : ""}</td></tr><tr><td style="padding:20px 32px 28px;border-top:1px solid #e4dfd2;font:12px/1.6 Arial,sans-serif;color:#777168">Questions? Reply to this email and our team will help.<br>If you did not make this reservation, you can ignore this message.</td></tr></table></td></tr></table></body></html>`,
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
