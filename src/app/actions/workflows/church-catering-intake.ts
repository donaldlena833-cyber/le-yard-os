"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCondition, throwDatabaseError } from "@/data/errors";
import { executeWorkflowAction, type WorkflowContext } from "@/data/execute";
import { verifyChurchSquareOrderWindowScope } from "@/data/read-models/church-square-order-window.server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchCateringIntakeDetailSchema, churchCateringIntakeSummarySchema } from "@/lib/integrations/church-catering-intake";
import { cateringJobSchema, cateringJobServiceDate, cateringJobTitle } from "@/lib/integrations/church-square-catering-jobs";

const detailInput = z.strictObject({ inquiryId: z.uuid() });
const convertInput = detailInput.extend({ requestId: z.uuid(), title: cateringJobTitle, serviceDate: cateringJobServiceDate });
const summaryList = z.array(churchCateringIntakeSummarySchema).max(50);

async function scopedLocation(context: WorkflowContext) {
  const session = await resolveWorkspaceSession();
  assertCondition(session.status === "ready" && session.context.identity.userId === context.actor.userId
    && await verifyChurchSquareOrderWindowScope(session.context), "forbidden", "Church Street catering access is required.");
  return session.context.activeLocation.id;
}

export async function listChurchCateringIntakeAction() {
  return executeWorkflowAction({
    operation: "church.catering.intake.list",
    schema: z.undefined(),
    input: undefined,
    persists: false,
    async run(context) {
      const location = await scopedLocation(context);
      const { data, error } = await context.supabase.rpc("list_church_catering_inquiries", { p_location_id: location })
        .abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "Catering requests could not be loaded.");
      const summary = summaryList.safeParse(data);
      assertCondition(summary.success, "database", "Catering requests could not be loaded.");
      return summary.data;
    },
  });
}

export async function getChurchCateringIntakeAction(input: z.input<typeof detailInput>) {
  return executeWorkflowAction({
    operation: "church.catering.intake.detail",
    schema: detailInput,
    input,
    persists: false,
    async run(context, { inquiryId }) {
      const location = await scopedLocation(context);
      const { data, error } = await context.supabase.rpc("get_church_catering_inquiry", {
        p_location_id: location, p_inquiry_id: inquiryId,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "The catering request could not be loaded.");
      const detail = churchCateringIntakeDetailSchema.safeParse(data);
      assertCondition(detail.success, "not_found", "The catering request is unavailable.");
      return detail.data;
    },
  });
}

export async function convertChurchCateringIntakeAction(input: z.input<typeof convertInput>) {
  return executeWorkflowAction({
    operation: "church.catering.intake.convert",
    schema: convertInput,
    input,
    async run(context, { inquiryId, requestId, title, serviceDate }) {
      const location = await scopedLocation(context);
      const { data, error } = await context.supabase.rpc("convert_church_catering_inquiry", {
        p_location_id: location, p_inquiry_id: inquiryId, p_request_id: requestId,
        p_title: title, p_service_date: serviceDate,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "The catering request could not be converted. Refresh the inbox and try again.");
      const job = cateringJobSchema.safeParse(data);
      assertCondition(job.success, "database", "The catering job could not be read.");
      revalidatePath("/catering");
      return job.data;
    },
  });
}
