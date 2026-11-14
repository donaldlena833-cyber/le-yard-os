import { z } from "zod";

export const cateringSources = [
  "direct",
  "google_business_profile",
  "tripadvisor",
  "apple_maps",
  "bing_places",
  "instagram",
  "facebook",
  "nextdoor",
  "website",
] as const;
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/);
const optionalText = (max: number) => text(max).default("");

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

// Service inquiry only. Marketing/profile consent is rejected unless explicitly false.
// Current-date enforcement belongs to the insertion transaction, after replay lookup,
// so an accepted inquiry can be retried after its preferred date without duplication.
export const cateringInquirySchema = z
  .object({
    audience: z.enum(["corporate", "private_party"]),
    contactName: text(120).min(1),
    email: z.string().trim().toLowerCase().max(254).email(),
    phone: optionalText(40).refine(
      (value) =>
        !value ||
        (/^[+()\d .-]+$/.test(value) && value.replace(/\D/g, "").length >= 7),
    ),
    company: optionalText(160),
    occasion: text(180).min(1),
    eventDate: optionalText(10).refine(
      (value) => !value || calendarDate(value),
    ),
    eventTime: optionalText(80),
    guestCount: z.number().int().min(1).max(99999).nullable().default(null),
    location: optionalText(300),
    dietaryNeeds: optionalText(500),
    format: optionalText(600),
    budget: optionalText(120),
    notes: optionalText(1200),
    source: z.enum(cateringSources),
    channel: z.literal("website"),
    purpose: z.literal("catering_service_inquiry"),
    noticeVersion: z.literal("catering-2026-10-21"),
    emailMarketingConsent: z.literal(false),
    smsMarketingConsent: z.literal(false),
    profileConsent: z.literal(false),
  })
  .strict()
  .transform((value) => ({
    ...value,
    company: value.audience === "corporate" ? value.company : "",
  }));

export type CateringInquiry = z.infer<typeof cateringInquirySchema>;
export const cateringRequestId = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
