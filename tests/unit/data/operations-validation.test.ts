import { describe, expect, it } from "vitest";
import {
  createIncidentInputSchema,
  createChecklistTemplateVersionInputSchema,
  createSopDraftInputSchema,
  createTaskInputSchema,
  recordChecklistResponseInputSchema,
  setMaintenanceStatusInputSchema,
} from "@/data/operations-schemas";

const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;

describe("operations command validation", () => {
  it("accepts bounded actor-free command payloads", () => {
    expect(createTaskInputSchema.safeParse({ requestId: id("1"), locationId: id("2"), title: "Reset dining room", description: null, priority: "normal", assignedEmployeeId: null, dueAt: "2026-08-02T02:00:00.000Z" }).success).toBe(true);
    expect(createIncidentInputSchema.safeParse({ requestId: id("1"), locationId: id("2"), incidentType: "equipment", severity: "medium", description: "The appliance was unplugged and removed from service.", occurredAt: "2026-08-01T18:00:00.000Z", involvedEmployeeIds: [], guestId: null }).success).toBe(true);
    expect(createChecklistTemplateVersionInputSchema.safeParse({ requestId: id("1"), locationId: id("2"), name: "Closing bar", checklistType: "closing", items: [{ label: "Lock front door", instructions: null, responseType: "checkbox", required: true, validation: {} }] }).success).toBe(true);
    expect(createSopDraftInputSchema.safeParse({ requestId: id("1"), locationId: id("2"), title: "Guest recovery", category: "Service", requiresAcknowledgement: true, body: "Escalate the concern to the manager on duty.", changeSummary: null }).success).toBe(true);
  });

  it("rejects browser-supplied actor and organization identity", () => {
    expect(createTaskInputSchema.safeParse({ requestId: id("1"), locationId: id("2"), title: "Reset dining room", description: null, priority: "normal", assignedEmployeeId: null, dueAt: null, organizationId: id("3"), createdBy: id("4") }).success).toBe(false);
  });

  it("rejects unbounded, non-json, and negative-money values", () => {
    expect(recordChecklistResponseInputSchema.safeParse({ requestId: id("1"), runId: id("2"), templateItemId: id("3"), response: undefined, storagePath: null, notes: null }).success).toBe(false);
    expect(setMaintenanceStatusInputSchema.safeParse({ requestId: id("1"), maintenanceRequestId: id("2"), status: "completed", assignedTo: null, vendorId: null, estimatedCostCents: -1, actualCostCents: null, dueAt: null, note: null }).success).toBe(false);
    expect(createChecklistTemplateVersionInputSchema.safeParse({ requestId: id("1"), locationId: id("2"), name: "Empty", checklistType: "custom", items: [] }).success).toBe(false);
  });
});
