import "server-only";

import {
  runCodexOwnerIntelligence,
  type OwnerIntelligenceProviderInput,
} from "@/lib/ai/codex-subscription.server";
import { type OwnerIntelligenceOutput } from "@/lib/ai/intelligence-contract";
import {
  runSub2ApiOwnerIntelligence,
  sub2ApiOwnerIntelligenceEnabled,
  sub2ApiOwnerIntelligenceModel,
} from "@/lib/ai/sub2api.server";

export type OwnerIntelligenceProviderResult = {
  output: OwnerIntelligenceOutput;
  model: string;
  sourceMode: "codex_subscription" | "sub2api_subscription";
};

export function selectedOwnerIntelligenceProvider() {
  const configured = process.env.LE_YARD_OWNER_INTELLIGENCE_PROVIDER?.trim();
  if (!configured || configured === "codex_subscription") return "codex_subscription" as const;
  if (configured === "sub2api_subscription") return "sub2api_subscription" as const;
  throw new Error("The owner-intelligence provider is invalid.");
}

export function ownerIntelligenceProviderPolicy() {
  return {
    selected: selectedOwnerIntelligenceProvider(),
    fallback: "none" as const,
    automaticActionExecution: false as const,
  };
}

export async function runOwnerIntelligence(
  input: OwnerIntelligenceProviderInput,
): Promise<OwnerIntelligenceProviderResult> {
  const provider = selectedOwnerIntelligenceProvider();
  if (provider === "sub2api_subscription") {
    if (!sub2ApiOwnerIntelligenceEnabled()) {
      throw new Error("The selected Sub2API owner-intelligence provider is incomplete.");
    }
    return {
      output: await runSub2ApiOwnerIntelligence(input),
      model: sub2ApiOwnerIntelligenceModel(),
      sourceMode: "sub2api_subscription",
    };
  }
  return {
    output: await runCodexOwnerIntelligence(input),
    model: "gpt-5.6-luna",
    sourceMode: "codex_subscription",
  };
}
