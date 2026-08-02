"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import { requestReportExportInputSchema } from "@/data/schemas";
import { requestReportExport } from "@/data/workflows/reports";

export async function requestReportExportAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "report.export_request",
    schema: requestReportExportInputSchema,
    input,
    run: requestReportExport,
  });
  if (result.ok && result.persisted) revalidatePath("/reports");
  return result;
}

