import { cateringInquirySchema } from "@/lib/catering-inquiry";
import { cateringPageSize, type CateringRegisterQuery, type CateringRegisterResult } from "@/lib/catering-register";

export function demoCateringRegister(query: CateringRegisterQuery): CateringRegisterResult {
  const entries = (["corporate", "private_party"] as const).map((audience, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    createdAt: "2026-10-26T10:00:00Z",
    brief: cateringInquirySchema.parse({
      audience, contactName: audience === "corporate" ? "Example office planner" : "Example party host",
      email: "example@example.com", company: "Example company",
      occasion: audience === "corporate" ? "Team gathering · sample" : "Birthday gathering · sample",
      eventDate: "2027-03-15", guestCount: index === 0 ? 30 : 25,
      location: "Example offsite location", source: "website", channel: "website", purpose: "catering_service_inquiry",
      noticeVersion: "catering-2026-10-21", emailMarketingConsent: false, smsMarketingConsent: false, profileConsent: false,
    }),
  })).filter(entry => query.audience === "all" || entry.brief.audience === query.audience);
  return { ok: true, entries: entries.slice((query.page - 1) * cateringPageSize, query.page * cateringPageSize), hasNext: false };
}
