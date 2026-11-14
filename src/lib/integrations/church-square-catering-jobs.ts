import { z } from "zod";
import { churchSquareInvoiceStates } from "./church-square-order-projection";

export const cateringJobStages = ["inquiry", "quoted", "confirmed", "completed", "canceled"] as const;
export type CateringJobStage = typeof cateringJobStages[number];
export const cateringJobStageTransitions: Record<CateringJobStage, readonly CateringJobStage[]> = {
  inquiry: ["inquiry", "quoted", "confirmed", "canceled"],
  quoted: ["quoted", "inquiry", "confirmed", "canceled"],
  confirmed: ["confirmed", "quoted", "completed", "canceled"],
  completed: ["completed"],
  canceled: ["canceled"],
};

export const cateringJobStage = z.enum(cateringJobStages);
export const cateringJobTitle = z.string().trim().min(1).max(120)
  .refine((value) => !Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  }), "Use a single line for the event title.");
export const cateringJobServiceDate = z.iso.date()
  .refine((date) => date >= "2000-01-01" && date <= "2100-12-31", "Enter a date between 2000 and 2100.");
export const cateringJobRevision = z.number().int().min(1).max(2_147_483_647);

export const cateringInvoiceReference = z.string().regex(/^[A-Za-z0-9_:-]{1,10}$/);
const cents = z.number().int().safe().nullable().transform((value) => value !== null && value >= 0 ? value : null);
const instant = z.iso.datetime({ offset: true });

export const cateringJobSchema = z.object({
  id: z.uuid(),
  title: cateringJobTitle,
  serviceDate: cateringJobServiceDate,
  stage: cateringJobStage,
  ownerName: z.string().min(1),
  revision: cateringJobRevision,
  updatedAt: instant,
  invoice: z.object({
    invoiceReference: cateringInvoiceReference,
    orderReference: cateringInvoiceReference,
    status: z.enum([...churchSquareInvoiceStates, "UNKNOWN"]),
    serviceDate: z.iso.date().nullable(),
    updatedAt: instant,
    serviceDateMismatch: z.boolean(),
    linkNeedsReview: z.boolean(),
    deposit: z.object({
      state: z.enum(["not_requested", "unknown", "unpaid", "partial", "satisfied", "review_required"]),
      dueCents: cents,
      completedCents: cents,
    }),
  }).nullable(),
});

export type CateringJob = z.infer<typeof cateringJobSchema>;
