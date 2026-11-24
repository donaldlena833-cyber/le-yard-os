"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCondition, throwDatabaseError, WorkflowError } from "@/data/errors";
import { executeWorkflowAction, type WorkflowContext } from "@/data/execute";
import { verifyChurchSquareOrderWindowScope } from "@/data/read-models/church-square-order-window.server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import {
  cateringInvoiceReference,
  cateringJobRevision,
  cateringJobSchema,
  cateringJobServiceDate,
  cateringJobStage,
  cateringJobTitle,
  cateringPackedPortionsReference,
  cateringPrepPortionsSchema,
} from "@/lib/integrations/church-square-catering-jobs";
import { churchSquareResourceId } from "@/lib/integrations/church-square-order-projection";
import { ChurchSquareOrderClient, churchSquareOrderConfiguration } from "@/lib/integrations/church-square-orders.server";
import { churchSandwichRecipeKeys } from "@/lib/kitchen/church-sandwich-bench";
import { createAdminClient } from "@/lib/supabase/admin";

const jobId = z.uuid();
const invoiceId = z.string().trim().pipe(churchSquareResourceId);
const createInput = z.strictObject({
  requestId: z.uuid(),
  title: cateringJobTitle,
  serviceDate: cateringJobServiceDate,
  stage: z.literal("inquiry"),
});
const updateInput = createInput.extend({
  jobId,
  expectedRevision: cateringJobRevision,
  stage: cateringJobStage,
});
const attachInput = z.strictObject({
  requestId: z.uuid(),
  jobId,
  expectedRevision: cateringJobRevision,
  invoiceId,
  invoiceUpdatedAt: z.iso.datetime({ offset: true }),
});
const detachInput = z.strictObject({
  requestId: z.uuid(),
  jobId,
  expectedRevision: cateringJobRevision,
  expectedInvoiceReference: cateringInvoiceReference,
});
const prepInput = z.strictObject({
  requestId: z.uuid(),
  jobId,
  expectedRevision: cateringJobRevision,
  portions: cateringPrepPortionsSchema,
  publish: z.boolean(),
}).refine(({ portions, publish }) => !publish || Object.values(portions).some((quantity) => quantity > 0), {
  path: ["portions"],
  message: "Enter at least one sandwich before publishing to Kitchen.",
});

const packInput = z.strictObject({
  requestId: z.uuid(),
  jobId,
  expectedRevision: cateringJobRevision,
  packedPortions: cateringPrepPortionsSchema,
  reference: cateringPackedPortionsReference,
});

async function locationIdFor(context: WorkflowContext) {
  const session = await resolveWorkspaceSession();
  assertCondition(session.status === "ready"
    && session.context.identity.userId === context.actor.userId
    && await verifyChurchSquareOrderWindowScope(session.context),
  "forbidden", "Church Street financial reports access is required.");
  return session.context.activeLocation.id;
}

const jobList = z.array(cateringJobSchema).max(100);

async function listJobs(context: WorkflowContext) {
  const locationId = await locationIdFor(context);
  const { data, error } = await context.supabase.rpc("list_church_catering_jobs", {
    p_location_id: locationId,
  }).abortSignal(AbortSignal.timeout(6_000));
  if (error) throwDatabaseError(error, "The catering jobs could not be loaded.");
  const parsed = jobList.safeParse(data);
  assertCondition(parsed.success, "database", "The catering jobs could not be loaded.");
  return parsed.data;
}

function parseSavedJob(data: unknown) {
  const parsed = cateringJobSchema.safeParse(data);
  assertCondition(parsed.success, "database", "The saved catering job could not be read.");
  return parsed.data;
}

async function saveJob(context: WorkflowContext, input: z.infer<typeof createInput> | z.infer<typeof updateInput>) {
  const locationId = await locationIdFor(context);
  const { data, error } = await context.supabase.rpc("save_church_catering_job", {
    p_request_id: input.requestId,
    p_location_id: locationId,
    p_title: input.title,
    p_service_date: input.serviceDate,
    p_stage: input.stage,
    ...("jobId" in input ? { p_job_id: input.jobId, p_expected_revision: input.expectedRevision } : {}),
  }).abortSignal(AbortSignal.timeout(6_000));
  if (error) throwDatabaseError(error, "The catering job could not be saved.");
  return parseSavedJob(data);
}

async function attachInvoice(context: WorkflowContext, input: z.infer<typeof attachInput>) {
  const locationId = await locationIdFor(context);
  const config = churchSquareOrderConfiguration();
  assertCondition(config, "conflict", "The Church Street Square connection is awaiting setup.");

  let invoice;
  try {
    invoice = await new ChurchSquareOrderClient(config).get("invoice", input.invoiceId);
  } catch {
    throw new WorkflowError("conflict", "Square could not verify that invoice for Church Street. Check the exact invoice ID and try again.");
  }
  assertCondition(invoice.updatedAt === input.invoiceUpdatedAt,
  "stale", "Square updated the invoice. Verify it again before attaching it.");
  assertCondition(invoice.serviceDate !== null, "conflict",
    "Set the sale or service date in Square to the catering job date, then verify the invoice again.");
  assertCondition([invoice.deposit.dueCents, invoice.deposit.completedCents].every((value) =>
    value === null || (value >= 0 && value <= 2_147_483_647)
  ), "conflict", "This invoice's deposit amounts require review in Square before attaching.");
  const { data, error } = await createAdminClient().rpc("service_attach_church_catering_invoice", {
    p_actor_id: context.actor.userId,
    p_request_id: input.requestId,
    p_location_id: locationId,
    p_job_id: input.jobId,
    p_expected_revision: input.expectedRevision,
    p_merchant_id: config.merchantId,
    p_square_location_id: config.locationId,
    p_invoice_id: invoice.id,
    p_order_id: invoice.orderId,
    p_invoice_status: invoice.status,
    p_invoice_service_date: invoice.serviceDate,
    p_invoice_updated_at: invoice.updatedAt,
    p_deposit_state: invoice.deposit.state,
    p_deposit_due_cents: invoice.deposit.dueCents,
    p_deposit_completed_cents: invoice.deposit.completedCents,
  }).abortSignal(AbortSignal.timeout(6_000));
  if (error) throwDatabaseError(error, "The Square invoice could not be attached.");
  return parseSavedJob(data);
}

export async function listChurchSquareCateringJobsAction() {
  return executeWorkflowAction({
    operation: "church-square.catering.jobs.list",
    schema: z.undefined(),
    input: undefined,
    persists: false,
    run: listJobs,
  });
}

export async function createChurchSquareCateringJobAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church-square.catering.job.create",
    schema: createInput,
    input,
    run: saveJob,
  });
  if (result.ok && result.persisted) refreshCatering();
  return result;
}

export async function updateChurchSquareCateringJobAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church-square.catering.job.update",
    schema: updateInput,
    input,
    run: saveJob,
  });
  if (result.ok && result.persisted) refreshCatering();
  return result;
}

export async function attachChurchSquareCateringInvoiceAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church-square.catering.job.attach",
    schema: attachInput,
    input,
    run: attachInvoice,
  });
  if (result.ok && result.persisted) refreshCatering();
  return result;
}

export async function detachChurchSquareCateringInvoiceAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church-square.catering.job.detach",
    schema: detachInput,
    input,
    run: async (context, { requestId, jobId, expectedRevision, expectedInvoiceReference }) => {
      const locationId = await locationIdFor(context);
      const { data, error } = await context.supabase.rpc("detach_church_catering_invoice", {
        p_request_id: requestId,
        p_location_id: locationId,
        p_job_id: jobId,
        p_expected_revision: expectedRevision,
        p_expected_invoice_reference: expectedInvoiceReference,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "The Square invoice could not be detached.");
      return parseSavedJob(data);
    },
  });
  if (result.ok && result.persisted) refreshCatering();
  return result;
}

export async function saveChurchSquareCateringProductionPlanAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church-square.catering.job.prep",
    schema: prepInput,
    input,
    run: async (context, { requestId, jobId, expectedRevision, portions, publish }) => {
      const locationId = await locationIdFor(context);
      const { data, error } = await context.supabase.rpc("save_church_catering_prep", {
        p_request_id: requestId,
        p_location_id: locationId,
        p_job_id: jobId,
        p_expected_revision: expectedRevision,
        p_portions: portions,
        p_publish: publish,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "Catering portions could not be saved.");
      return parseSavedJob(data);
    },
  });
  if (result.ok && result.persisted) refreshCatering();
  return result;
}

export async function saveChurchSquareCateringPackedPortionsAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church-square.catering.job.pack",
    schema: packInput,
    input,
    run: async (context, { requestId, jobId, expectedRevision, packedPortions, reference }) => {
      const locationId = await locationIdFor(context);
      const { data, error } = await context.supabase.rpc("save_church_catering_packed_portions", {
        p_request_id: requestId,
        p_location_id: locationId,
        p_job_id: jobId,
        p_expected_revision: expectedRevision,
        p_packed_portions: packedPortions,
        p_reference: reference,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "Packed catering portions could not be saved.");
      const job = parseSavedJob(data);
      const confirmed = job.packedPortions;
      assertCondition(job.id === jobId && confirmed
        && churchSandwichRecipeKeys.every((key) => confirmed[key] === packedPortions[key]),
      "database", "The packed catering count could not be confirmed.");
      return job;
    },
  });
  if (result.ok && result.persisted) refreshCatering();
  return result;
}

function refreshCatering() {
  revalidatePath("/catering");
  revalidatePath("/today");
  revalidatePath("/kitchen");
}
