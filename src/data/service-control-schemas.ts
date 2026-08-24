import { z } from "zod";

const uuid = z.string().uuid();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const recordServiceAvailabilityInputSchema = z.object({
  requestId: uuid,
  locationId: uuid,
  subjectType: z.enum(["menu_item", "component"]),
  subjectId: uuid,
  expectedEventId: uuid.nullable().optional(),
  status: z.enum(["available", "running_low", "eighty_sixed", "restored"]),
  estimatedPortions: z.number().finite().nonnegative().max(1_000_000).nullable().optional(),
  reason: optionalText(500),
  effectiveAt: z.string().datetime({ offset: true }),
  expectedRestorationAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: optionalText(2_000),
}).strict().refine(
  (value) => !value.expectedRestorationAt || value.expectedRestorationAt > value.effectiveAt,
  { path: ["expectedRestorationAt"], message: "Restoration must be after the effective time." },
);

export const saveManagerLogInputSchema = z.object({
  requestId: uuid,
  entryId: uuid.nullable().optional(),
  locationId: uuid,
  businessDate: z.iso.date(),
  servicePeriod: z.enum(["lunch", "dinner", "all_day", "other"]),
  category: z.enum(["foh", "boh", "guest", "employee", "equipment", "inventory", "vendor", "cash", "safety", "maintenance", "reservation", "other"]),
  severity: z.enum(["informational", "awareness", "action_required", "critical"]),
  title: z.string().trim().min(1).max(180),
  narrative: z.string().trim().min(1).max(10_000),
  status: z.enum(["informational", "needs_follow_up", "in_progress", "resolved"]),
  resolution: optionalText(10_000),
  dueDate: z.iso.date().nullable().optional(),
}).strict();

export const savePreshiftInputSchema = z.object({
  requestId: uuid,
  preshiftId: uuid.nullable().optional(),
  locationId: uuid,
  businessDate: z.iso.date(),
  servicePeriod: z.enum(["lunch", "dinner", "all_day", "other"]),
  status: z.enum(["draft", "published"]),
  bookedCovers: z.number().int().nonnegative().max(100_000).nullable().optional(),
  projectedCovers: z.number().int().nonnegative().max(100_000).nullable().optional(),
  vipNotes: optionalText(5_000),
  allergyNotes: optionalText(5_000),
  largePartyNotes: optionalText(5_000),
  specials: optionalText(5_000),
  staffingNotes: optionalText(5_000),
  serviceGoal: optionalText(2_000),
  trainingPoint: optionalText(2_000),
  managerNotes: optionalText(5_000),
}).strict();

export const acknowledgePreshiftInputSchema = z.object({
  requestId: uuid,
  preshiftId: uuid,
  comment: optionalText(2_000),
}).strict();

export type RecordServiceAvailabilityInput = z.infer<typeof recordServiceAvailabilityInputSchema>;
export type SaveManagerLogInput = z.infer<typeof saveManagerLogInputSchema>;
export type SavePreshiftInput = z.infer<typeof savePreshiftInputSchema>;
export type AcknowledgePreshiftInput = z.infer<typeof acknowledgePreshiftInputSchema>;
