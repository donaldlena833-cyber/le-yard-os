"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCondition, WorkflowError } from "@/data/errors";
import { executeWorkflowAction, type WorkflowContext } from "@/data/execute";
import { verifyChurchSquareOrderWindowScope } from "@/data/read-models/church-square-order-window.server";
import { loadLiveServiceDayContext } from "@/data/read-models/service-day-context";
import { saveManagerLog } from "@/data/workflows/service-control";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchSquareResourceId } from "@/lib/integrations/church-square-order-projection";
import {
  ChurchSquareOrderClient,
  churchSquareOrderConfiguration,
} from "@/lib/integrations/church-square-orders.server";

const invoiceId = z.string().trim().pipe(churchSquareResourceId);
const lookupInput = z.strictObject({ invoiceId });
const handoffInput = lookupInput.extend({
  requestId: z.uuid(),
  invoiceUpdatedAt: z.iso.datetime({ offset: true }),
});

async function readCateringInvoice(context: WorkflowContext, id: string, forLog = false) {
  const session = await resolveWorkspaceSession();
  assertCondition(session.status === "ready"
    && session.context.identity.userId === context.actor.userId
    && await verifyChurchSquareOrderWindowScope(session.context),
  "forbidden", "Church Street financial reports access is required.");
  const workspace = session.context;
  const canLog = workspace.capabilities.includes("manager_log.manage");
  if (forLog) assertCondition(canLog, "forbidden", "Manager Log access is required.");

  const configuration = churchSquareOrderConfiguration();
  assertCondition(configuration, "conflict", "The Church Street Square connection is awaiting setup.");
  try {
    const invoice = await new ChurchSquareOrderClient(configuration).get("invoice", id);
    return {
      workspace, canLog,
      facts: {
        invoiceReference: invoice.id.slice(-10),
        orderReference: invoice.orderId.slice(-10),
        status: invoice.status,
        serviceDate: invoice.serviceDate,
        updatedAt: invoice.updatedAt,
        deposit: invoice.deposit,
      },
    };
  } catch {
    throw new WorkflowError("conflict", "Square could not verify that invoice for Church Street. Check the exact invoice ID and try again.");
  }
}

export async function lookupChurchSquareCateringInvoiceAction(input: unknown) {
  return executeWorkflowAction({
    operation: "church-square.catering.lookup",
    schema: lookupInput,
    input,
    persists: false,
    run: async (context, { invoiceId }) => {
      const { facts, canLog } = await readCateringInvoice(context, invoiceId);
      return { ...facts, canLog };
    },
  });
}

export async function saveChurchSquareCateringHandoffAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church-square.catering.handoff",
    schema: handoffInput,
    input,
    run: async (context, { requestId, invoiceId, invoiceUpdatedAt }) => {
      const { facts, workspace } = await readCateringInvoice(context, invoiceId, true);
      assertCondition(facts.updatedAt === invoiceUpdatedAt, "conflict",
        "Square updated the invoice. Verify it again before saving a handoff.");
      const serviceDay = await loadLiveServiceDayContext(workspace);
      assertCondition(serviceDay.ok, "database", "The current operating day could not be resolved.");
      const narrative = [
        `Square invoice ID suffix ${facts.invoiceReference} · order ID suffix ${facts.orderReference}.`,
        `Square service date ${facts.serviceDate ?? "unavailable"} · invoice status ${facts.status.toLowerCase().replaceAll("_", " ")}.`,
        `Observed deposit state ${facts.deposit.state.replaceAll("_", " ")}. Amounts in USD cents — due ${facts.deposit.dueCents ?? "unavailable"}, completed ${facts.deposit.completedCents ?? "unavailable"}.`,
        `Square invoice updated ${facts.updatedAt}. Recheck the live invoice before making prep or staffing decisions.`,
      ].join("\n");
      const entry = await saveManagerLog(context, {
        requestId, locationId: workspace.activeLocation.id, businessDate: serviceDay.data.businessDate,
        servicePeriod: "other", category: "other", severity: "informational",
        title: `Catering invoice review · ${facts.invoiceReference}`,
        narrative, status: "needs_follow_up",
      });
      return { id: entry.id };
    },
  });
  if (result.ok && result.persisted) revalidatePath("/service");
  return result;
}
