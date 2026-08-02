import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowContext } from "@/data/execute";
import {
  cancelTimeOff,
  createEmployeeDocumentUploadUrl,
  decideTimeOff,
  deleteAvailability,
  finalizeEmployeeDocument,
  saveAvailability,
  saveCertification,
  saveEmergencyContact,
  saveTimeOff,
  updateEmployeeDocument,
} from "@/data/workflows/people-operations";

vi.mock("server-only", () => ({}));

const { adminRpc } = vi.hoisted(() => ({ adminRpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: adminRpc }),
}));

const ids = {
  request: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  location: "33333333-3333-4333-8333-333333333333",
  employee: "44444444-4444-4444-8444-444444444444",
  record: "55555555-5555-4555-8555-555555555555",
  user: "66666666-6666-4666-8666-666666666666",
};

function query(row: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
    single: vi.fn(async () => ({ data: row, error: null })),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  return builder;
}

function workflowContext(fileBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])) {
  const objectPath = `${ids.organization}/${ids.location}/employee-documents/${ids.employee}/${ids.request}-signed-handbook.pdf`;
  const rows: Record<string, unknown> = {
    locations: {
      id: ids.location,
      organization_id: ids.organization,
      is_active: true,
      timezone: "America/New_York",
    },
    employees: {
      id: ids.employee,
      organization_id: ids.organization,
      user_id: ids.user,
      home_location_id: ids.location,
      employment_status: "active",
    },
  };
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    void args;
    const data: Record<string, unknown> = {
      save_availability_rule: { id: ids.record, updated_at: "2026-08-01T12:00:00Z" },
      delete_availability_rule: ids.record,
      save_time_off_request: { id: ids.record, status: "pending", updated_at: "2026-08-01T12:00:00Z" },
      cancel_time_off_request: { id: ids.record, status: "cancelled" },
      decide_time_off_request: { id: ids.record, status: "approved", decided_at: "2026-08-01T13:00:00Z" },
      save_employee_certification: { id: ids.record, verified_at: null, updated_at: "2026-08-01T12:00:00Z" },
      save_employee_emergency_contact: { id: ids.record, is_primary: true, updated_at: "2026-08-01T12:00:00Z" },
      update_employee_document_metadata: { id: ids.record, title: "Policy", is_employee_visible: false },
    };
    return { data: data[name], error: null };
  });
  const createSignedUploadUrl = vi.fn(async (path: string) => ({
    data: { path, signedUrl: "https://private.example.test/upload", token: "signed-token" },
    error: null,
  }));
  const download = vi.fn(async () => ({
    data: new Blob([fileBytes], { type: "application/pdf" }),
    error: null,
  }));
  const storageFrom = vi.fn(() => ({ createSignedUploadUrl, download }));
  adminRpc.mockResolvedValue({
    data: { id: ids.request, storage_path: objectPath },
    error: null,
  });
  return {
    workflow: {
      supabase: {
        from: vi.fn((table: string) => query(rows[table] ?? null)),
        rpc,
        storage: { from: storageFrom },
      },
      actor: {
        userId: ids.user,
        aal: "aal1",
        memberships: [
          {
            organizationId: ids.organization,
            role: "manager",
            locationIds: [ids.location],
            organizationWide: false,
          },
        ],
      },
    } as unknown as WorkflowContext,
    rpc,
    createSignedUploadUrl,
    download,
    objectPath,
  };
}

describe("People Operations workflow contracts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses every 016 command and preserves restaurant-local leave times", async () => {
    const { workflow, rpc, objectPath } = workflowContext();

    await saveAvailability(workflow, {
      requestId: ids.request,
      employeeId: ids.employee,
      ruleId: null,
      locationId: ids.location,
      weekday: 1,
      availableFrom: "09:00",
      availableUntil: "17:00",
      isAvailable: true,
      effectiveFrom: "2026-08-03",
      effectiveTo: null,
      notes: null,
    });
    await deleteAvailability(workflow, {
      requestId: ids.request,
      ruleId: ids.record,
    });
    await saveTimeOff(workflow, {
      requestId: ids.request,
      employeeId: ids.employee,
      timeOffId: null,
      locationId: ids.location,
      startsAtLocal: "2026-08-10T09:00",
      endsAtLocal: "2026-08-10T17:00",
      reason: "Appointment",
    });
    await cancelTimeOff(workflow, {
      requestId: ids.request,
      timeOffId: ids.record,
    });
    await decideTimeOff(workflow, {
      requestId: ids.request,
      timeOffId: ids.record,
      approve: true,
      decisionNote: null,
    });
    await saveCertification(workflow, {
      requestId: ids.request,
      employeeId: ids.employee,
      certificationId: null,
      certificationType: "Food handler",
      issuer: "City Health",
      credentialNumber: null,
      issuedOn: "2026-01-01",
      expiresOn: "2027-01-01",
      verified: false,
    });
    await saveEmergencyContact(workflow, {
      requestId: ids.request,
      employeeId: ids.employee,
      contactId: null,
      name: "Jamie Rivera",
      relationship: "Partner",
      phone: "212-555-0199",
      email: null,
      isPrimary: true,
    });
    await finalizeEmployeeDocument(workflow, {
      requestId: ids.request,
      employeeId: ids.employee,
      locationId: ids.location,
      objectPath,
      documentType: "handbook",
      title: "Signed handbook",
      mimeType: "application/pdf",
      sizeBytes: 5,
      employeeVisible: true,
    });
    await updateEmployeeDocument(workflow, {
      requestId: ids.request,
      documentId: ids.record,
      documentType: "policy",
      title: "Policy",
      employeeVisible: false,
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "save_availability_rule",
      "delete_availability_rule",
      "save_time_off_request",
      "cancel_time_off_request",
      "decide_time_off_request",
      "save_employee_certification",
      "save_employee_emergency_contact",
      "update_employee_document_metadata",
    ]);
    expect(rpc.mock.calls[2][1]).toEqual({
      p_request_id: ids.request,
      p_employee_id: ids.employee,
      p_time_off_id: null,
      p_location_id: ids.location,
      p_starts_at: "2026-08-10T13:00:00.000Z",
      p_ends_at: "2026-08-10T21:00:00.000Z",
      p_reason: "Appointment",
    });
    expect(rpc.mock.calls.map(([, args]) => Object.keys(args).sort())).toEqual([
      ["p_available_from", "p_available_until", "p_effective_from", "p_effective_to", "p_employee_id", "p_is_available", "p_location_id", "p_notes", "p_request_id", "p_rule_id", "p_weekday"],
      ["p_request_id", "p_rule_id"],
      ["p_employee_id", "p_ends_at", "p_location_id", "p_reason", "p_request_id", "p_starts_at", "p_time_off_id"],
      ["p_request_id", "p_time_off_id"],
      ["p_approve", "p_decision_note", "p_request_id", "p_time_off_id"],
      ["p_certification_id", "p_certification_type", "p_credential_number", "p_employee_id", "p_expires_on", "p_issued_on", "p_issuer", "p_request_id", "p_verified"],
      ["p_contact_id", "p_email", "p_employee_id", "p_is_primary", "p_name", "p_phone", "p_relationship", "p_request_id"],
      ["p_document_id", "p_document_type", "p_is_employee_visible", "p_request_id", "p_title"],
    ]);
    expect(adminRpc).toHaveBeenCalledWith(
      "service_finalize_employee_document",
      {
        p_request_id: ids.request,
        p_actor_id: ids.user,
        p_actor_aal: "aal1",
        p_employee_id: ids.employee,
        p_location_id: ids.location,
        p_storage_path: objectPath,
        p_document_type: "handbook",
        p_title: "Signed handbook",
        p_mime_type: "application/pdf",
        p_size_bytes: 5,
        p_is_employee_visible: true,
      },
    );
  });

  it("builds a tenant/location/employee-scoped private upload path", async () => {
    const { workflow, createSignedUploadUrl } = workflowContext();
    const result = await createEmployeeDocumentUploadUrl(workflow, {
      uploadId: ids.request,
      employeeId: ids.employee,
      locationId: ids.location,
      documentType: "handbook",
      title: "Signed handbook",
      mimeType: "application/pdf",
      sizeBytes: 5,
      employeeVisible: true,
      fileName: "Signed handbook.pdf",
    });

    expect(result.objectPath).toBe(
      `${ids.organization}/${ids.location}/employee-documents/${ids.employee}/${ids.request}-Signed-handbook.pdf`,
    );
    expect(createSignedUploadUrl).toHaveBeenCalledWith(result.objectPath, {
      upsert: false,
    });
  });

  it("rejects mislabeled document bytes before binding metadata", async () => {
    const { workflow, rpc, objectPath } = workflowContext(
      new Uint8Array([0x68, 0x74, 0x6d, 0x6c, 0x21]),
    );

    await expect(
      finalizeEmployeeDocument(workflow, {
        requestId: ids.request,
        employeeId: ids.employee,
        locationId: ids.location,
        objectPath,
        documentType: "handbook",
        title: "Signed handbook",
        mimeType: "application/pdf",
        sizeBytes: 5,
        employeeVisible: true,
      }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(rpc).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });
});
