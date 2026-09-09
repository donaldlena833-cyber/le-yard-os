import { z } from "zod";

export const SMS_AI_MODEL = "gemini-3.1-flash-lite";
export const SMS_AI_WEEKLY_MICRO_USD = 5_000_000;
export const SMS_AI_RESERVATION_MICRO_USD = 10_000;
export const smsAiDecisionSchema = z
  .object({
    intent: z.enum([
      "contact",
      "hours_menu",
      "reservation",
      "reservation_change",
      "private_event",
      "employee",
      "complaint",
      "human",
      "photo",
      "greeting",
      "thanks",
      "unknown",
    ]),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    partySize: z.number().int().min(1).max(100).nullable(),
    time: z.string().max(40).nullable(),
    summary: z.string().min(1).max(500),
    photoDescription: z.string().max(400).nullable(),
  })
  .strict();
export type SmsAiDecision = z.infer<typeof smsAiDecisionSchema>;

export function smsAiEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return (
    env.SMS_AI_PILOT_ENABLED === "true" && Boolean(env.GEMINI_API_KEY?.trim())
  );
}

export function smsPilotContact(
  phone: string,
  env: Record<string, string | undefined> = process.env,
) {
  if (!smsAiEnabled(env)) return false;
  const normalized = phone.trim();
  const business = (
    env.TWILIO_FROM_NUMBER || env.TWILIO_PHONE_NUMBER || ""
  ).trim();
  return /^\+[1-9]\d{7,14}$/.test(normalized) && normalized !== business;
}

export function smsAiCost(inputTokens: number, outputTokens: number) {
  // Reviewed standard Gemini 3.1 Flash-Lite prices: $0.25 / $1.50 per million.
  return Math.ceil(inputTokens * 0.25 + outputTokens * 1.5);
}
export function smsAiWeek(now = new Date()) {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export type SmsAiPlan =
  | { type: "reply"; text: string }
  | { type: "handoff"; reason: string }
  | { type: "availability"; date: string; partySize: number };
export function planSmsAiReply(
  decision: SmsAiDecision,
  today: string,
  clarifications = 0,
): SmsAiPlan {
  switch (decision.intent) {
    case "contact":
      return {
        type: "reply",
        text: "Le Yard AI assistant: You can reach our team on this number or office@leyardny.com. Our website is https://leyardny.com.",
      };
    case "greeting":
      return {
        type: "reply",
        text: "Le Yard AI assistant: Hi! I can help with questions and collect requests for our team. What can I help you with?",
      };
    case "thanks":
      return {
        type: "reply",
        text: "Le Yard AI assistant: You're welcome. Our team can help here whenever you need a follow-up.",
      };
    case "reservation": {
      const date = decision.date;
      if (
        date &&
        (!Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date ||
          date < today)
      )
        return {
          type: "reply",
          text: "Le Yard AI assistant: Please send the future reservation date in YYYY-MM-DD format and your party size.",
        };
      if (!date || !decision.partySize)
        return {
          type: "reply",
          text: `Le Yard AI assistant: Please send ${!date && !decision.partySize ? "your preferred date and party size" : !date ? "your preferred date" : "your party size"}. No table has been booked.`,
        };
      return { type: "availability", date, partySize: decision.partySize };
    }
    case "unknown":
      return clarifications === 0
        ? {
            type: "reply",
            text: "Le Yard AI assistant: Could you describe what you need help with? I can collect a reservation question or a work request for our team.",
          }
        : { type: "handoff", reason: "Request needs human clarification" };
    default:
      return {
        type: "handoff",
        reason: {
          hours_menu: "Business detail needs verification",
          reservation_change: "Reservation change or confirmation",
          private_event: "Private event request",
          employee: "Employee request",
          complaint: "Guest concern",
          human: "Human assistance requested",
          photo: "Photo needs team review",
        }[decision.intent],
      };
  }
}
