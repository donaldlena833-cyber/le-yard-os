import "server-only";
import { z } from "zod";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { churchSquareCountConfiguration } from "./church-square-configuration.server";
import { ChurchSquareLoyaltyClient } from "./church-square-loyalty.server";
import { regularsClaimSchema, regularsJourney, regularsRequest, regularsCroissantChoices } from "./church-regulars-streak";
import type { Json } from "@/types/database.generated";

export class RegularsConflict extends Error {}

export async function manageChurchRegulars(workspace: WorkspaceContextValue, input: z.infer<typeof regularsRequest>) {
  const config = churchSquareCountConfiguration();
  if (!config || process.env.LE_YARD_REGULARS_STREAKS_ENABLED !== "true") throw new Error("Regulars unavailable");
  const db = createAdminClient();
  async function record(action: string, payload: Record<string, Json> = {}) {
    const { data, error } = await db.rpc("service_church_regulars_treat", {
      p_actor_id: workspace.identity.userId, p_location_id: workspace.activeLocation.id,
      p_account_id: input.accountId, p_action: action, p_payload: payload,
    });
    if (error) {
      if (["PT409", "23505"].includes(error.code)) throw new RegularsConflict("Treat changed. Refresh before handing it over.");
      throw new Error("Treat record unavailable");
    }
    return z.object({ selectedClaimId: z.uuid().nullable(), claims: z.array(regularsClaimSchema).max(5000) }).parse(data);
  }
  let saved = await record("read");
  const visits = await new ChurchSquareLoyaltyClient(config).regularsVisits(input.accountId);
  let journey = regularsJourney(visits, saved.claims);
  if (input.action === "reserve") {
    const reward = journey.rewards.find(candidate => candidate.milestone === input.milestone && candidate.earnedOn === input.earnedOn);
    if (!reward) throw new RegularsConflict("The qualifying purchases changed. Refresh this member.");
    saved = await record("reserve", { milestone: reward.milestone, earnedOn: reward.earnedOn,
      cycleStart: reward.cycleStart, cycleEnd: reward.cycleEnd, qualifyingDays: reward.qualifyingDays,
      orderIds: reward.orderIds, requestId: input.requestId });
  } else if (input.action === "fulfill") {
    const claim = saved.claims.find(candidate => candidate.id === input.claimId);
    if (!claim || claim.status === "canceled" || (claim.status !== "fulfilled" && !journey.rewards.some(reward => reward.claim?.id === claim.id))) {
      throw new RegularsConflict("The treat needs review before handoff.");
    }
    if (claim.milestone === 3 && !regularsCroissantChoices.some(label => label === input.itemLabel)) throw new RegularsConflict("Choose the croissant handed over.");
    saved = await record("fulfill", { claimId: input.claimId, itemLabel: input.itemLabel });
  } else if (input.action === "cancel") {
    saved = await record("cancel", { claimId: input.claimId });
  }
  journey = regularsJourney(visits, saved.claims);
  return { ...journey, rewards: journey.rewards.map(reward => ({ milestone: reward.milestone, name: reward.name,
    earnedOn: reward.earnedOn, cycleStart: reward.cycleStart, cycleEnd: reward.cycleEnd, claim: reward.claim })) };
}
