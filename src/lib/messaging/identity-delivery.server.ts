import "server-only";

import { guestInterestVerificationToken } from "@/lib/guest-interest-verification.server";

export type IdentityDeliveryJob = {
  id: string;
  claimToken: string;
  workflow: "guest_interest_verification" | "user_invitation";
  correlationId: string;
  organizationId: string;
  locationId: string | null;
  channel: "email" | "sms";
  destination: string;
  destinationHash: string;
  templateData: Record<string, unknown>;
  attempts: number;
};

export type IdentityDeliveryResult = {
  state: "sent" | "failed" | "not_configured";
  providerMessageId: string | null;
};

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ]!,
  );
}

function actionFor(job: IdentityDeliveryJob) {
  if (job.workflow === "user_invitation") {
    const actionUrl = job.templateData.actionUrl;
    if (typeof actionUrl !== "string" || !actionUrl.startsWith("https://")) {
      throw new Error("Invitation action link is unavailable.");
    }
    return {
      subject: "You’re invited to Le Yard OS",
      headline: "Your Le Yard workspace is ready.",
      body: "Use the secure link to finish your account setup. The link expires automatically.",
      label: "Accept invitation",
      url: actionUrl,
    };
  }

  const expiresAt = job.templateData.expiresAt;
  if (
    !job.locationId ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(new Date(expiresAt).valueOf())
  ) {
    throw new Error("Guest-interest verification evidence is incomplete.");
  }
  const token = guestInterestVerificationToken({
    requestId: job.correlationId,
    organizationId: job.organizationId,
    locationId: job.locationId,
    destinationHash: job.destinationHash,
    expiresAt,
  });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) throw new Error("The canonical application URL is unavailable.");
  const url = new URL("/api/v1/guest-interest/verify", appUrl);
  url.searchParams.set("token", token);
  return {
    subject: "Confirm your Le Yard email",
    headline: "Confirm your place on the Le Yard list.",
    body: "Review and confirm this email address before we add it to the Le Yard guest list.",
    label: "Review email confirmation",
    url: url.toString(),
  };
}

export async function sendIdentityDelivery(
  job: IdentityDeliveryJob,
): Promise<IdentityDeliveryResult> {
  if (job.channel !== "email") {
    return { state: "not_configured", providerMessageId: null };
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from =
    process.env.LE_YARD_TRANSACTIONAL_EMAIL_FROM?.trim() ||
    process.env.RESERVATION_EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    return { state: "not_configured", providerMessageId: null };
  }

  let copy: ReturnType<typeof actionFor>;
  try {
    copy = actionFor(job);
  } catch {
    return { state: "failed", providerMessageId: null };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `identity-delivery-${job.id}`,
      },
      body: JSON.stringify({
        from,
        to: [job.destination],
        subject: copy.subject,
        html: `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:32px;color:#171713"><p style="letter-spacing:.14em;text-transform:uppercase">Le Yard</p><h1>${escapeHtml(copy.headline)}</h1><p>${escapeHtml(copy.body)}</p><p><a href="${escapeHtml(copy.url)}">${escapeHtml(copy.label)}</a></p><p style="color:#666">If you did not request this, ignore this email.</p></body></html>`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { state: "failed", providerMessageId: null };
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > 8_192) {
      return { state: "sent", providerMessageId: null };
    }
    const parsed = JSON.parse(body) as { id?: unknown };
    return {
      state: "sent",
      providerMessageId:
        typeof parsed.id === "string" && parsed.id.length <= 500
          ? parsed.id
          : null,
    };
  } catch {
    return { state: "failed", providerMessageId: null };
  }
}

