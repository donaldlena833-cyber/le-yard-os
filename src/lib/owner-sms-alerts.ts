const INBOX_URL = "https://phone.leyardny.com/messages";
const CONTACT_URL = "https://phone.leyardny.com/le-yard-messages.vcf";
const MAX_SMS_UNITS = 1600;
const MAX_PAYLOAD_UNITS = 1150;
const MAX_PARTS = 16;
const MAX_NAME_UNITS = 80;
const MAX_SENDER_UNITS = 40;

export type OwnerSmsAlertInput = {
  sourceSid: string;
  from: string;
  body: string;
  mediaCount: number;
  guestName?: string;
};

export function ownerSmsConversationUrl(sourceSid: string): string {
  if (typeof sourceSid !== "string" || !/^(SM|MM)[a-f0-9]{32}$/i.test(sourceSid)) {
    throw new Error("A valid source message SID is required for an owner SMS alert.");
  }
  return `${INBOX_URL}?message=${sourceSid}`;
}

export function ownerSmsReplyGuidance(): string {
  return `Replying to this text sends to Le Yard, not the guest. Open the shared inbox to reply to the guest: ${INBOX_URL}\nWhen you reply there, a manual reply pauses AI for that conversation.`;
}

export function ownerSmsSetupMessage(): string {
  return [
    "Le Yard Messages",
    "Setup/test message for owner phone alerts. This is not a guest message.",
    `Shared inbox: ${INBOX_URL}`,
    `Save the Le Yard Messages business contact: ${CONTACT_URL}`,
    ownerSmsReplyGuidance(),
  ].join("\n");
}

// String lengths are UTF-16 units. Never cut between a surrogate pair.
function safeEnd(value: string, start: number, limit: number): number {
  const end = Math.min(start + limit, value.length);
  if (
    end < value.length &&
    value.charCodeAt(end - 1) >= 0xd800 &&
    value.charCodeAt(end - 1) <= 0xdbff &&
    value.charCodeAt(end) >= 0xdc00 &&
    value.charCodeAt(end) <= 0xdfff
  ) {
    return end - 1;
  }
  return end;
}

export function formatOwnerSmsAlert(input: OwnerSmsAlertInput): string[] {
  const conversationUrl = ownerSmsConversationUrl(input.sourceSid);
  const sender = typeof input.from === "string" ? input.from.replace(/\s+/gu, " ").trim() : "";
  if (!sender || sender.length > MAX_SENDER_UNITS || !/^[A-Za-z0-9+ ._-]+$/.test(sender) || !/[A-Za-z0-9]/.test(sender)) {
    throw new Error("A valid sender label of at most 40 characters is required for an owner SMS alert.");
  }
  if (typeof input.body !== "string") {
    throw new Error("An owner SMS alert body must be a string.");
  }
  if (!Number.isSafeInteger(input.mediaCount) || input.mediaCount < 0) {
    throw new Error("An owner SMS alert attachment count must be a nonnegative safe integer.");
  }
  if (input.guestName !== undefined && typeof input.guestName !== "string") {
    throw new Error("An owner SMS alert guest name must be a string.");
  }

  const cleanName = (input.guestName ?? "").replace(/\s+/gu, " ").trim();
  const guestName = cleanName.slice(0, safeEnd(cleanName, 0, MAX_NAME_UNITS));
  const identity = guestName ? `${guestName} (${sender})` : sender;
  const footer = [
    ...(input.mediaCount > 0
      ? [`MMS: ${input.mediaCount} attachment${input.mediaCount === 1 ? "" : "s"}. Open the shared inbox link to view.`]
      : []),
    "Open conversation / reply as Le Yard:",
    conversationUrl,
  ].join("\n");

  const wrap = (body: string, part: number, total: number): string =>
    `Le Yard Messages${total > 1 ? `\nPart ${part}/${total}` : ""}\nFrom: ${identity}\n\n${body}\n\n${footer}`;

  // Reserve the largest part marker before splitting, so numbering can never
  // push a complete SMS over the provider body limit.
  const payloadLimit = Math.min(
    MAX_PAYLOAD_UNITS,
    MAX_SMS_UNITS - wrap("", MAX_PARTS, MAX_PARTS).length,
  );
  if (input.body.length > payloadLimit * MAX_PARTS) {
    throw new Error("Owner SMS alert exceeds the 16-part limit.");
  }

  const chunks: string[] = [];
  let offset = 0;
  do {
    if (chunks.length === MAX_PARTS) {
      throw new Error("Owner SMS alert exceeds the 16-part limit.");
    }
    const end = safeEnd(input.body, offset, payloadLimit);
    chunks.push(input.body.slice(offset, end));
    offset = end;
  } while (offset < input.body.length);

  return chunks.map((body, index) => wrap(body, index + 1, chunks.length));
}
