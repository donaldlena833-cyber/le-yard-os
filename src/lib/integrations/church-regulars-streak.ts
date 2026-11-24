import { z } from "zod";

export const regularsStartedOn = "2026-11-24";
export const regularsCroissantChoices = ["Croissant", "Almond Croissant", "Chocolate Almond Croissant", "Ham and Cheese Croissant"] as const;
export const regularsMilestones = [
  { days: 3, key: "croissant", name: "A croissant of their choice" },
  { days: 7, key: "mystery", name: "A surprise chosen at the counter" },
] as const;

export type RegularsMilestone = 3 | 7;
export type RegularsVisit = { day: string; orderId: string };
export type RegularsClaim = {
  id: string; milestone: RegularsMilestone; earnedOn: string;
  cycleStart: string; cycleEnd: string; status: "reserved" | "fulfilled" | "canceled";
  reservedAt: string; fulfilledAt: string | null; itemLabel: string | null;
};

const day = z.iso.date();
const squareId = z.string().regex(/^[A-Za-z0-9_:-]{1,192}$/);
export const regularsRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), accountId: squareId }).strict(),
  z.object({ action: z.literal("reserve"), accountId: squareId, milestone: z.union([z.literal(3), z.literal(7)]),
    earnedOn: day, requestId: z.uuid() }).strict(),
  z.object({ action: z.literal("fulfill"), accountId: squareId, claimId: z.uuid(),
    itemLabel: z.string().trim().min(1).max(160) }).strict(),
  z.object({ action: z.literal("cancel"), accountId: squareId, claimId: z.uuid() }).strict(),
]);

export function regularsLocalDay(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function dayNumber(value: string) { return Date.parse(`${value}T12:00:00Z`) / 86_400_000; }

export function regularsJourney(visits: RegularsVisit[], claims: RegularsClaim[], now = new Date()) {
  const today = regularsLocalDay(now);
  const byDay = new Map<string, RegularsVisit>();
  for (const visit of visits) {
    if (!day.safeParse(visit.day).success || visit.day < regularsStartedOn || visit.day > today) continue;
    const previous = byDay.get(visit.day);
    if (!previous || visit.orderId < previous.orderId) byDay.set(visit.day, visit);
  }
  const days = [...byDay.keys()].sort();
  const cycles: string[][] = [];
  for (const date of days) {
    const current = cycles.at(-1);
    if (current && dayNumber(date) - dayNumber(current.at(-1)!) === 1) current.push(date);
    else cycles.push([date]);
  }
  const latest = cycles.at(-1) ?? [];
  const last = latest.at(-1);
  const currentStreak = last && dayNumber(today) - dayNumber(last) <= 1 ? latest.length : 0;
  const rewards = cycles.flatMap(cycle => regularsMilestones.flatMap(milestone => {
    if (cycle.length < milestone.days) return [];
    const cycleStart = cycle[0], cycleEnd = cycle.at(-1)!;
    // A late/backdated purchase can join or extend a cycle. Overlapping claim
    // windows still consume the milestone, rather than granting it twice.
    const existing = claims.find(claim => claim.status !== "canceled" && claim.milestone === milestone.days
      && claim.cycleStart <= cycleEnd && claim.cycleEnd >= cycleStart);
    const qualifyingDays = cycle.slice(0, milestone.days);
    return [{ milestone: milestone.days, name: milestone.name, earnedOn: qualifyingDays.at(-1)!,
      cycleStart, cycleEnd, qualifyingDays, orderIds: qualifyingDays.map(date => byDay.get(date)!.orderId),
      claim: existing ?? null }];
  }));
  const reviewClaims = claims.filter(claim => claim.status !== "canceled"
    && !rewards.some(reward => reward.claim?.id === claim.id));
  return { currentStreak, visitedToday: byDay.has(today), latestVisitDay: days.at(-1) ?? null,
    rewards, reviewClaims, checkedAt: now.toISOString() };
}

export type RegularsJourney = ReturnType<typeof regularsJourney>;

export const regularsClaimSchema = z.object({
  id: z.uuid(), milestone: z.union([z.literal(3), z.literal(7)]), earnedOn: day, cycleStart: day, cycleEnd: day,
  status: z.enum(["reserved", "fulfilled", "canceled"]), reservedAt: z.iso.datetime({ offset: true }),
  fulfilledAt: z.iso.datetime({ offset: true }).nullable(), itemLabel: z.string().max(160).nullable(),
});
export const regularsCounterSnapshot = z.object({
  currentStreak: z.number().int().nonnegative(), visitedToday: z.boolean(), latestVisitDay: day.nullable(),
  checkedAt: z.iso.datetime({ offset: true }), reviewClaims: z.array(regularsClaimSchema),
  rewards: z.array(z.object({ milestone: z.union([z.literal(3), z.literal(7)]), name: z.string(),
    earnedOn: day, cycleStart: day, cycleEnd: day, claim: regularsClaimSchema.nullable() })),
});
export type RegularsCounterSnapshot = z.infer<typeof regularsCounterSnapshot>;
