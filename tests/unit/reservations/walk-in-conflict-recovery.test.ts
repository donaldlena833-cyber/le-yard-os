import { describe, expect, it, vi } from "vitest";
import { WorkflowError } from "@/data/errors";
import type { WorkflowContext } from "@/data/execute";
import { saveReservationWithGuest } from "@/data/workflows/reservations";

const input = {
  requestId: "10000000-0000-4000-8000-000000000001",
  locationId: "20000000-0000-4000-8000-000000000001",
  displayName: "Walk In Guest",
  email: null,
  phone: null,
  reservedAt: "2026-08-13T18:00:00.000-04:00",
  durationMinutes: 90,
  partySize: 2,
  specialRequests: null,
  source: "walk_in" as const,
  tableIds: ["30000000-0000-4000-8000-000000000001"],
};

function context(rpc: ReturnType<typeof vi.fn>) {
  return {
    supabase: { rpc },
    actor: {
      userId: "40000000-0000-4000-8000-000000000001",
      aal: "aal1",
      memberships: [],
    },
  } as unknown as WorkflowContext;
}

describe("walk-in conflict recovery", () => {
  it("retries a raced table suggestion without assigning that table", async () => {
    const saved = { id: "50000000-0000-4000-8000-000000000001" };
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "23P01" } })
      .mockResolvedValueOnce({ data: saved, error: null });

    await expect(saveReservationWithGuest(context(rpc), input)).resolves.toBe(saved);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_request_id: input.requestId,
      p_table_ids: input.tableIds,
    });
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({
      p_request_id: input.requestId,
      p_table_ids: [],
    });
  });

  it("does not weaken conflicts for non-walk-in reservations", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23P01" },
    });

    await expect(
      saveReservationWithGuest(context(rpc), { ...input, source: "phone" }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkflowError>>({ code: "conflict" }),
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
