"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  approveTipRunInputSchema,
  calculateTipRunInputSchema,
  exportTipPayrollInputSchema,
  prepareTipRunInputSchema,
} from "@/data/schemas";
import {
  approveTipRun,
  calculateTipRun,
  exportTipPayroll,
  prepareTipRun,
} from "@/data/workflows/tips";

function refreshFinancialViews() {
  revalidatePath("/closeout");
  revalidatePath("/reports");
  revalidatePath("/today");
}

export async function prepareTipRunAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "tips.prepare_from_closeout",
    schema: prepareTipRunInputSchema,
    input,
    run: prepareTipRun,
  });
  if (result.ok && result.persisted) refreshFinancialViews();
  return result;
}

export async function calculateTipRunAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "tips.calculate",
    schema: calculateTipRunInputSchema,
    input,
    run: calculateTipRun,
  });
  if (result.ok && result.persisted) refreshFinancialViews();
  return result;
}

export async function approveTipRunAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "tips.approve",
    schema: approveTipRunInputSchema,
    input,
    run: approveTipRun,
  });
  if (result.ok && result.persisted) refreshFinancialViews();
  return result;
}

export async function exportTipPayrollAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "tips.export_payroll_csv",
    schema: exportTipPayrollInputSchema,
    input,
    run: exportTipPayroll,
  });
  if (result.ok && result.persisted) {
    revalidatePath("/closeout");
    revalidatePath("/reports");
  }
  return result;
}
