import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowContext } from "@/data/execute";
import { recordChecklistResponse } from "@/data/workflows/operations";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const ids = {
  request: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  location: "33333333-3333-4333-8333-333333333333",
  run: "44444444-4444-4444-8444-444444444444",
  template: "55555555-5555-4555-8555-555555555555",
  item: "66666666-6666-4666-8666-666666666666",
  employee: "77777777-7777-4777-8777-777777777777",
  user: "88888888-8888-4888-8888-888888888888",
  response: "99999999-9999-4999-8999-999999999999",
};

const validPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const storagePath = `${ids.organization}/${ids.location}/checklists/${ids.run}/${ids.request}-evidence.png`;

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

function context(responseType: "photo" | "checkbox", bytes = validPng) {
  const rpc = vi.fn(async () => ({
    data: { id: ids.response, responded_at: "2026-08-01T12:00:00.000Z" },
    error: null,
  }));
  return {
    workflow: {
      supabase: {
        from: vi.fn((table: string) => query(
          table === "checklist_runs"
            ? {
                id: ids.run,
                organization_id: ids.organization,
                location_id: ids.location,
                template_id: ids.template,
                assigned_employee_id: ids.employee,
                status: "in_progress",
              }
            : {
                id: ids.item,
                organization_id: ids.organization,
                template_id: ids.template,
                response_type: responseType,
              },
        )),
        rpc,
        storage: {
          from: vi.fn(() => ({
            download: vi.fn(async () => ({
              data: new Blob([bytes], { type: "image/png" }),
              error: null,
            })),
          })),
        },
      },
      actor: {
        userId: ids.user,
        aal: "aal2",
        memberships: [{
          organizationId: ids.organization,
          role: "manager",
          locationIds: [ids.location],
          organizationWide: false,
        }],
      },
    } as unknown as WorkflowContext,
    rpc,
  };
}

describe("verified checklist photo binding", () => {
  beforeEach(() => vi.clearAllMocks());

  it("binds through the service client only after user-scoped byte verification", async () => {
    const adminRpc = vi.fn(async () => ({
      data: { id: ids.response, responded_at: "2026-08-01T12:00:00.000Z" },
      error: null,
    }));
    vi.mocked(createAdminClient).mockReturnValue({ rpc: adminRpc } as never);
    const { workflow, rpc } = context("photo");
    const response = {
      file_name: "evidence.png",
      mime_type: "image/png",
      size_bytes: validPng.byteLength,
    };

    await expect(recordChecklistResponse(workflow, {
      requestId: ids.request,
      runId: ids.run,
      templateItemId: ids.item,
      response,
      storagePath,
      notes: "Closing evidence",
    })).resolves.toEqual({
      id: ids.response,
      respondedAt: "2026-08-01T12:00:00.000Z",
    });

    expect(rpc).not.toHaveBeenCalled();
    expect(adminRpc).toHaveBeenCalledWith("bind_verified_checklist_photo_response", {
      p_request_id: ids.request,
      p_actor_id: ids.user,
      p_actor_aal: "aal2",
      p_run_id: ids.run,
      p_template_item_id: ids.item,
      p_response: response,
      p_storage_path: storagePath,
      p_notes: "Closing evidence",
      p_mime_type: "image/png",
      p_size_bytes: validPng.byteLength,
    });
  });

  it("never invokes service binding for invalid image bytes", async () => {
    const adminRpc = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ rpc: adminRpc } as never);
    const { workflow } = context("photo", new Uint8Array(validPng.byteLength));

    await expect(recordChecklistResponse(workflow, {
      requestId: ids.request,
      runId: ids.run,
      templateItemId: ids.item,
      response: {
        file_name: "evidence.png",
        mime_type: "image/png",
        size_bytes: validPng.byteLength,
      },
      storagePath,
      notes: null,
    })).rejects.toMatchObject({ code: "validation" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("keeps non-photo responses on the authenticated RPC", async () => {
    const { workflow, rpc } = context("checkbox");
    await recordChecklistResponse(workflow, {
      requestId: ids.request,
      runId: ids.run,
      templateItemId: ids.item,
      response: true,
      storagePath: null,
      notes: null,
    });

    expect(createAdminClient).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("record_checklist_response", {
      p_request_id: ids.request,
      p_run_id: ids.run,
      p_template_item_id: ids.item,
      p_response: true,
      p_storage_path: null,
      p_notes: null,
    });
  });
});
