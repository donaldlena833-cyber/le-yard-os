import { describe, expect, it, vi } from "vitest";
import {
  resolveReceiptDuplicateInputSchema,
  setDeliveryReceiptLinkInputSchema,
  setExpenseReceiptLinkInputSchema,
} from "@/data/receipt-schemas";
import {
  RECEIPTS_PAGE_SIZE,
  RECEIPT_REFERENCE_WINDOW_SIZE,
} from "@/data/read-models/receipts";
import type { WorkflowContext } from "@/data/execute";
import { resolveReceiptDuplicate } from "@/data/workflows/receipts";

vi.mock("server-only", () => ({}));

const ids = {
  request: "11111111-1111-4111-8111-111111111111",
  target: "22222222-2222-4222-8222-222222222222",
  receipt: "33333333-3333-4333-8333-333333333333",
  possibleReceipt: "44444444-4444-4444-8444-444444444444",
  organization: "55555555-5555-4555-8555-555555555555",
  location: "66666666-6666-4666-8666-666666666666",
  user: "77777777-7777-4777-8777-777777777777",
};

describe("receipt reconciliation contracts", () => {
  it("uses an explicit bounded page and recent-reference window", () => {
    expect(RECEIPTS_PAGE_SIZE).toBe(50);
    expect(RECEIPT_REFERENCE_WINDOW_SIZE).toBe(150);
  });

  it("accepts actor-free duplicate decisions and link or unlink commands", () => {
    expect(resolveReceiptDuplicateInputSchema.safeParse({
      requestId: ids.request,
      matchId: ids.target,
      resolution: "not_duplicate",
    }).success).toBe(true);
    for (const schema of [setExpenseReceiptLinkInputSchema, setDeliveryReceiptLinkInputSchema]) {
      expect(schema.safeParse({
        requestId: ids.request,
        targetId: ids.target,
        receiptId: ids.receipt,
      }).success).toBe(true);
      expect(schema.safeParse({
        requestId: ids.request,
        targetId: ids.target,
        receiptId: null,
      }).success).toBe(true);
    }
  });

  it("rejects forged actors and unsupported merge decisions", () => {
    expect(resolveReceiptDuplicateInputSchema.safeParse({
      requestId: ids.request,
      matchId: ids.target,
      resolution: "merged",
      resolvedBy: ids.receipt,
    }).success).toBe(false);
  });

  it("passes an immediate exact duplicate-resolution retry to the idempotent RPC", async () => {
    let resolution: "duplicate" | null = null;
    const rpc = vi.fn(async () => {
      resolution = "duplicate";
      return {
        data: {
          id: ids.target,
          resolution,
          resolved_at: "2026-08-01T12:00:00.000Z",
        },
        error: null,
      };
    });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "receipt_duplicate_matches") {
          const builder = {
            select: vi.fn(),
            eq: vi.fn(),
            maybeSingle: vi.fn(async () => ({
              data: {
                id: ids.target,
                organization_id: ids.organization,
                receipt_id: ids.receipt,
                possible_duplicate_id: ids.possibleReceipt,
                resolution,
              },
              error: null,
            })),
          };
          builder.select.mockReturnValue(builder);
          builder.eq.mockReturnValue(builder);
          return builder;
        }
        const builder = {
          select: vi.fn(),
          in: vi.fn(async () => ({
            data: [ids.receipt, ids.possibleReceipt].map((id) => ({
              id,
              organization_id: ids.organization,
              location_id: ids.location,
              review_status: "pending",
            })),
            error: null,
          })),
        };
        builder.select.mockReturnValue(builder);
        return builder;
      }),
      rpc,
    };
    const context = {
      supabase,
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
    } as unknown as WorkflowContext;
    const input = {
      requestId: ids.request,
      matchId: ids.target,
      resolution: "duplicate" as const,
    };

    await expect(resolveReceiptDuplicate(context, input)).resolves.toMatchObject({
      id: ids.target,
      resolution: "duplicate",
    });
    await expect(resolveReceiptDuplicate(context, input)).resolves.toMatchObject({
      id: ids.target,
      resolution: "duplicate",
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith("resolve_receipt_duplicate", {
      p_request_id: ids.request,
      p_match_id: ids.target,
      p_resolution: "duplicate",
    });
  });
});
