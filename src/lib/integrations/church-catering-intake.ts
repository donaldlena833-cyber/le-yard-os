import { z } from "zod";
import { cateringSources } from "@/lib/catering-inquiry";

export const churchCateringIntakePath = "/api/v1/church-catering-inquiries";

export const churchCateringIntakeSummarySchema = z.object({
  id: z.uuid(),
  audience: z.enum(["corporate", "private_party"]),
  eventDate: z.iso.date().nullable(),
  guestCount: z.number().int().min(1).max(99999).nullable(),
  source: z.enum(cateringSources),
  receivedAt: z.iso.datetime({ offset: true }),
  jobId: z.uuid().nullable(),
});

export const churchCateringIntakeDetailSchema = churchCateringIntakeSummarySchema.extend({
  occasion: z.string().min(1).max(180),
  contactName: z.string().min(1).max(120),
  email: z.email().max(254),
  phone: z.string().max(40).nullable(),
  company: z.string().max(160).nullable(),
  eventTime: z.string().max(80).nullable(),
  location: z.string().max(300).nullable(),
  format: z.string().max(600).nullable(),
  budget: z.string().max(120).nullable(),
});

export type ChurchCateringIntakeSummary = z.infer<typeof churchCateringIntakeSummarySchema>;
export type ChurchCateringIntakeDetail = z.infer<typeof churchCateringIntakeDetailSchema>;
