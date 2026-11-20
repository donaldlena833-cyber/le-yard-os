import { z } from "zod";

export const loyaltyPageSize = 20;
export const loyaltyRequest = z.strictObject({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  cursor: z.string().min(1).max(2048).optional(),
});

export const loyaltySnapshot = z.object({
  checkedAt: z.iso.datetime(),
  status: z.enum(["active", "inactive", "not_configured", "permissions_required", "unavailable"]),
  program: z.object({
    pointsLabel: z.string(),
    rewards: z.array(z.object({ name: z.string(), points: z.number().int().safe().nonnegative() })),
    sharedAcrossLocations: z.boolean(),
  }).nullable(),
  members: z.array(z.object({
    id: z.string(),
    name: z.string(),
    phoneSuffix: z.string(),
    points: z.number().int().safe(),
    lifetimePoints: z.number().int().safe().nonnegative().nullable(),
    birthday: z.string().nullable(),
    enrolledAt: z.string().nullable(),
    profileAvailable: z.boolean(),
    nextReward: z.object({ name: z.string(), pointsRemaining: z.number().int().safe().nonnegative() }).nullable(),
  })).max(loyaltyPageSize),
  cursor: z.string().nullable(),
  profilesComplete: z.boolean(),
});
export type LoyaltySnapshot = z.infer<typeof loyaltySnapshot>;

export function emptyLoyaltySnapshot(status: LoyaltySnapshot["status"]): LoyaltySnapshot {
  return { checkedAt: new Date().toISOString(), status, program: null, members: [], cursor: null, profilesComplete: true };
}

/** Only month/day leaves the server. Square permits 0000 for an unknown year. */
export function loyaltyBirthday(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const monthDay = value.slice(5);
  const parsed = new Date(`2000-${monthDay}T12:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(5, 10) === monthDay ? monthDay : null;
}
