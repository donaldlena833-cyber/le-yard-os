import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowContext } from "@/data/execute";
import {
  acknowledgeSop,
  completeChecklistRun,
  createIncident,
  createChecklistTemplateVersion,
  createMaintenanceRequest,
  createTask,
  createSopDraft,
  createSopVersion,
  publishChecklistTemplate,
  publishSopVersion,
  recordChecklistResponse,
  setIncidentStatus,
  setMaintenanceStatus,
  startChecklistRun,
  transitionTask,
  updateSopDraft,
} from "@/data/workflows/operations";

vi.mock("server-only", () => ({}));

const ids = {
  request: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  location: "33333333-3333-4333-8333-333333333333",
  record: "44444444-4444-4444-8444-444444444444",
  template: "55555555-5555-4555-8555-555555555555",
  item: "66666666-6666-4666-8666-666666666666",
  employee: "77777777-7777-4777-8777-777777777777",
  document: "88888888-8888-4888-8888-888888888888",
  user: "99999999-9999-4999-8999-999999999999",
};

function query(row: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return builder;
}

function context(role: "manager" | "employee" = "manager") {
  const rows: Record<string, unknown> = {
    locations: { id: ids.location, organization_id: ids.organization, is_active: true },
    tasks: { id: ids.record, organization_id: ids.organization, location_id: ids.location, assigned_employee_id: ids.employee },
    checklist_templates: { id: ids.template, organization_id: ids.organization, location_id: ids.location, is_active: true },
    checklist_runs: { id: ids.record, organization_id: ids.organization, location_id: ids.location, template_id: ids.template, assigned_employee_id: ids.employee, status: "in_progress" },
    checklist_template_items: { id: ids.item, organization_id: ids.organization, template_id: ids.template },
    sop_versions: { id: ids.record, organization_id: ids.organization, sop_document_id: ids.document, version: 2, published_at: "2026-08-01T12:00:00.000Z" },
    sop_documents: { id: ids.document, organization_id: ids.organization, location_id: ids.location, current_version: 2, is_published: true },
    employees: { id: ids.employee, organization_id: ids.organization },
    maintenance_requests: { id: ids.record, organization_id: ids.organization, location_id: ids.location },
    incidents: { id: ids.record, organization_id: ids.organization, location_id: ids.location },
  };
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    void name;
    void args;
    return { data: { id: ids.record, status: "in_progress", created_at: "2026-08-01T12:00:00.000Z", started_at: "2026-08-01T12:00:00.000Z", responded_at: "2026-08-01T12:01:00.000Z", completed_at: null, acknowledged_at: "2026-08-01T12:02:00.000Z", resolved_at: null }, error: null };
  });
  return {
    workflow: {
      supabase: { from: vi.fn((table: string) => query(rows[table])), rpc },
      actor: {
        userId: ids.user,
        aal: "aal2",
        memberships: [{ organizationId: ids.organization, role, locationIds: [ids.location], organizationWide: false }],
      },
    } as unknown as WorkflowContext,
    rpc,
  };
}

describe("operations workflow RPC contracts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses every frozen 012 function name and exact argument key", async () => {
    const { workflow, rpc } = context();
    await createTask(workflow, { requestId: ids.request, locationId: ids.location, title: "Reset room", description: null, priority: "normal", assignedEmployeeId: null, dueAt: null });
    await transitionTask(workflow, { requestId: ids.request, taskId: ids.record, status: "in_progress", note: null });
    await startChecklistRun(workflow, { requestId: ids.request, locationId: ids.location, templateId: ids.template, businessDate: "2026-08-01", assignedEmployeeId: ids.employee });
    await recordChecklistResponse(workflow, { requestId: ids.request, runId: ids.record, templateItemId: ids.item, response: true, storagePath: null, notes: null });
    await completeChecklistRun(workflow, { requestId: ids.request, runId: ids.record, note: null });
    await acknowledgeSop(workflow, { requestId: ids.request, sopVersionId: ids.record });
    await createMaintenanceRequest(workflow, { requestId: ids.request, locationId: ids.location, title: "Ice machine", description: "Water is leaking near the drain.", category: "equipment", priority: "high", assignedTo: null, vendorId: null, dueAt: null });
    await setMaintenanceStatus(workflow, { requestId: ids.request, maintenanceRequestId: ids.record, status: "in_progress", assignedTo: "Facilities", vendorId: null, estimatedCostCents: 12500, actualCostCents: null, dueAt: null, note: "Vendor contacted" });
    await createIncident(workflow, { requestId: ids.request, locationId: ids.location, incidentType: "equipment", severity: "medium", description: "The appliance was removed from service.", occurredAt: "2026-08-01T18:00:00.000Z", involvedEmployeeIds: [], guestId: null });
    await setIncidentStatus(workflow, { requestId: ids.request, incidentId: ids.record, status: "investigating", followUp: "Manager is reviewing the equipment." });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["create_task", "transition_task", "start_checklist_run", "record_checklist_response", "complete_checklist_run", "acknowledge_sop", "create_maintenance_request", "set_maintenance_status", "create_incident", "set_incident_status"]);
    expect(
      rpc.mock.calls.map(([name, args]) => [name, Object.keys(args).sort()]),
    ).toEqual([
      ["create_task", ["p_assigned_employee_id", "p_description", "p_due_at", "p_location_id", "p_priority", "p_request_id", "p_title"]],
      ["transition_task", ["p_note", "p_request_id", "p_status", "p_task_id"]],
      ["start_checklist_run", ["p_assigned_employee_id", "p_business_date", "p_location_id", "p_request_id", "p_template_id"]],
      ["record_checklist_response", ["p_notes", "p_request_id", "p_response", "p_run_id", "p_storage_path", "p_template_item_id"]],
      ["complete_checklist_run", ["p_note", "p_request_id", "p_run_id"]],
      ["acknowledge_sop", ["p_request_id", "p_sop_version_id"]],
      ["create_maintenance_request", ["p_assigned_to", "p_category", "p_description", "p_due_at", "p_location_id", "p_priority", "p_request_id", "p_title", "p_vendor_id"]],
      ["set_maintenance_status", ["p_actual_cost_cents", "p_assigned_to", "p_due_at", "p_estimated_cost_cents", "p_maintenance_id", "p_note", "p_request_id", "p_status", "p_vendor_id"]],
      ["create_incident", ["p_description", "p_guest_id", "p_incident_type", "p_involved_employee_ids", "p_location_id", "p_occurred_at", "p_request_id", "p_severity"]],
      ["set_incident_status", ["p_follow_up", "p_incident_id", "p_request_id", "p_status"]],
    ]);
    expect(rpc.mock.calls[7][1]).toEqual({ p_request_id: ids.request, p_maintenance_id: ids.record, p_status: "in_progress", p_assigned_to: "Facilities", p_vendor_id: null, p_estimated_cost_cents: 12500, p_actual_cost_cents: null, p_due_at: null, p_note: "Vendor contacted" });
    expect(rpc.mock.calls[8][1]).toEqual({ p_request_id: ids.request, p_location_id: ids.location, p_incident_type: "equipment", p_severity: "medium", p_description: "The appliance was removed from service.", p_occurred_at: "2026-08-01T18:00:00.000Z", p_involved_employee_ids: [], p_guest_id: null });
  });

  it("blocks employee task creation before calling a command RPC", async () => {
    const { workflow, rpc } = context("employee");
    await expect(createTask(workflow, { requestId: ids.request, locationId: ids.location, title: "Manager task", description: null, priority: "normal", assignedEmployeeId: null, dueAt: null })).rejects.toMatchObject({ code: "forbidden" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the frozen 017 checklist and SOP authoring RPC contracts", async () => {
    const { workflow, rpc } = context();
    await createChecklistTemplateVersion(workflow, {
      requestId: ids.request,
      locationId: ids.location,
      name: "Closing bar",
      checklistType: "closing",
      items: [{
        label: "Lock front door",
        instructions: "Confirm the deadbolt.",
        responseType: "checkbox",
        required: true,
        validation: {},
      }],
    });
    await publishChecklistTemplate(workflow, {
      requestId: ids.request,
      templateId: ids.template,
    });
    await createSopDraft(workflow, {
      requestId: ids.request,
      locationId: ids.location,
      title: "Guest recovery",
      category: "Service",
      requiresAcknowledgement: true,
      body: "Escalate the concern to the manager on duty.",
      changeSummary: null,
    });
    await createSopVersion(workflow, {
      requestId: ids.request,
      sopDocumentId: ids.document,
      body: "Escalate and document the concern.",
      changeSummary: "Added documentation step.",
    });
    await updateSopDraft(workflow, {
      requestId: ids.request,
      sopVersionId: ids.record,
      body: "Escalate, resolve, and document the concern.",
      changeSummary: "Clarified resolution.",
    });
    await publishSopVersion(workflow, {
      requestId: ids.request,
      sopVersionId: ids.record,
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "create_checklist_template_version",
      "publish_checklist_template",
      "create_sop_draft",
      "create_sop_version",
      "update_sop_draft",
      "publish_sop_version",
    ]);
    expect(rpc.mock.calls[0][1]).toEqual({
      p_request_id: ids.request,
      p_location_id: ids.location,
      p_name: "Closing bar",
      p_checklist_type: "closing",
      p_items: [{
        label: "Lock front door",
        instructions: "Confirm the deadbolt.",
        response_type: "checkbox",
        required: true,
        validation: {},
      }],
    });
    expect(rpc.mock.calls[5][1]).toEqual({
      p_request_id: ids.request,
      p_sop_version_id: ids.record,
    });
  });
});
