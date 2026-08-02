import { describe, expect, it, vi } from "vitest";
import type { WorkflowContext } from "@/data/execute";
import { finalizeReceiptUpload } from "@/data/workflows/receipts";
import { sha256Hex } from "@/lib/storage/file-integrity";

vi.mock("server-only", () => ({}));

const ids = {
  request: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  location: "33333333-3333-4333-8333-333333333333",
  receipt: "44444444-4444-4444-8444-444444444444",
  file: "55555555-5555-4555-8555-555555555555",
  duplicate: "66666666-6666-4666-8666-666666666666",
  user: "77777777-7777-4777-8777-777777777777",
};

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const objectPath = `${ids.organization}/${ids.location}/receipts/${ids.receipt}/${ids.request}-receipt.png`;

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

function context(returnedHash = sha256Hex(pngBytes)) {
  const rpc = vi.fn(async () => ({
    data: {
      receipt_id: ids.receipt,
      content_hash: returnedHash,
      duplicate_receipt_id: ids.duplicate,
      duplicate_match_id: ids.file,
    },
    error: null,
  }));
  const from = vi.fn((table: string) => query(
    table === "receipts"
      ? {
          id: ids.receipt,
          organization_id: ids.organization,
          location_id: ids.location,
          review_status: "pending",
        }
      : {
          id: ids.file,
          receipt_id: ids.receipt,
          storage_path: objectPath,
          mime_type: "image/png",
          size_bytes: pngBytes.byteLength,
        },
  ));
  return {
    workflow: {
      supabase: {
        from,
        rpc,
        storage: {
          from: vi.fn(() => ({
            download: vi.fn(async () => ({
              data: new Blob([pngBytes], { type: "image/png" }),
              error: null,
            })),
          })),
        },
      },
      actor: {
        userId: ids.user,
        aal: "aal1",
        memberships: [{
          organizationId: ids.organization,
          role: "manager",
          locationIds: [ids.location],
          organizationWide: false,
        }],
      },
    } as unknown as WorkflowContext,
    rpc,
    from,
  };
}

const input = {
  requestId: ids.request,
  receiptId: ids.receipt,
  objectPath,
  fileName: "receipt.png",
  mimeType: "image/png" as const,
  sizeBytes: pngBytes.byteLength,
};

describe("receipt fingerprint finalization", () => {
  it("uses the actor-derived fingerprint RPC and preserves exact retry evidence", async () => {
    const { workflow, rpc, from } = context();
    await expect(finalizeReceiptUpload(workflow, input)).resolves.toMatchObject({
      receiptId: ids.receipt,
      contentHash: sha256Hex(pngBytes),
      duplicateReceiptId: ids.duplicate,
      alreadyApplied: true,
    });
    await expect(finalizeReceiptUpload(workflow, input)).resolves.toMatchObject({
      contentHash: sha256Hex(pngBytes),
      alreadyApplied: true,
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith("record_receipt_fingerprint", {
      p_request_id: ids.request,
      p_receipt_id: ids.receipt,
      p_content_hash: sha256Hex(pngBytes),
    });
    expect(from.mock.calls.map(([table]) => table)).not.toContain("receipt_duplicate_matches");
  });

  it("rejects forged fingerprint results", async () => {
    const { workflow } = context("0".repeat(64));
    await expect(finalizeReceiptUpload(workflow, input)).rejects.toMatchObject({
      code: "database",
    });
  });
});
