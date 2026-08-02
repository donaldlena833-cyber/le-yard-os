"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  approveTipPolicyVersionInputSchema,
  configureRetentionPolicyInputSchema,
  configureTipPolicyInputSchema,
  saveTipPolicyDraftInputSchema,
} from "@/data/financial-configuration-schemas";
import {
  approveTipPolicyVersion,
  configureRetentionPolicy,
  configureTipPolicy,
  saveTipPolicyDraft,
} from "@/data/workflows/financial-configuration";

function refreshFinancialConfiguration() {
  revalidatePath("/closeout");
  revalidatePath("/settings");
  revalidatePath("/reports");
}

export async function configureTipPolicyAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "tip-policy.configure",
    schema: configureTipPolicyInputSchema,
    input,
    run: configureTipPolicy,
  });
  if (result.ok && result.persisted) refreshFinancialConfiguration();
  return result;
}

export async function saveTipPolicyDraftAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "tip-policy-draft.save",
    schema: saveTipPolicyDraftInputSchema,
    input,
    run: saveTipPolicyDraft,
  });
  if (result.ok && result.persisted) refreshFinancialConfiguration();
  return result;
}

export async function approveTipPolicyVersionAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "tip-policy-version.approve",
    schema: approveTipPolicyVersionInputSchema,
    input,
    run: approveTipPolicyVersion,
  });
  if (result.ok && result.persisted) refreshFinancialConfiguration();
  return result;
}

export async function configureRetentionPolicyAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "retention-policy.configure",
    schema: configureRetentionPolicyInputSchema,
    input,
    run: configureRetentionPolicy,
  });
  if (result.ok && result.persisted) refreshFinancialConfiguration();
  return result;
}
