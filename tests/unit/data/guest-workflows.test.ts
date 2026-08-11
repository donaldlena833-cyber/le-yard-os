import { describe, expect, it, vi } from "vitest";
import type { WorkflowContext } from "@/data/execute";
import { mergeGuest } from "@/data/workflows/guests";

vi.mock("server-only", () => ({}));

const ids = {
  organization: "20000000-0000-4000-8000-000000000001",
  location: "30000000-0000-4000-8000-000000000001",
  source: "40000000-0000-4000-8000-000000000001",
  target: "40000000-0000-4000-8000-000000000002",
  request: "50000000-0000-4000-8000-000000000001",
  user: "60000000-0000-4000-8000-000000000001",
};

function replayContext() {
  const mergeEvidence = {
    id: ids.request,
    source_guest_id: ids.source,
    target_guest_id: ids.target,
    merged_at: "2026-08-10T12:00:00.000Z",
  };
  const guestRows = [
    {
      id: ids.source,
      organization_id: ids.organization,
      merged_into_id: ids.target,
    },
    {
      id: ids.target,
      organization_id: ids.organization,
      merged_into_id: null,
    },
  ];
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

  const from = vi.fn((table: string) => {
    if (table === "guests") {
      const guest = guestRows.shift();
      if (!guest) throw new Error("Replay queried an unexpected guest.");
      return query(guest);
    }
    if (table === "guest_merge_events") return query({ id: ids.request });
    throw new Error(`Replay unexpectedly queried ${table}.`);
  });
  const rpc = vi.fn(async () => ({ data: [mergeEvidence], error: null }));

  return {
    workflow: {
      supabase: { from, rpc },
      actor: {
        userId: ids.user,
        aal: "aal1",
        memberships: [
          {
            organizationId: ids.organization,
            role: "employee",
            locationIds: [ids.location],
            organizationWide: false,
          },
        ],
      },
    } as unknown as WorkflowContext,
    from,
    rpc,
  };
}

describe("guest workflow replay", () => {
  it("reaches the immutable merge replay after the source is already merged", async () => {
    const { workflow, from, rpc } = replayContext();

    await expect(
      mergeGuest(workflow, {
        requestId: ids.request,
        organizationId: ids.organization,
        locationId: ids.location,
        sourceGuestId: ids.source,
        targetGuestId: ids.target,
        matchScore: 0.99,
        reasons: ["Reviewed duplicate"],
      }),
    ).resolves.toEqual({
      id: ids.request,
      sourceGuestId: ids.source,
      targetGuestId: ids.target,
      mergedAt: "2026-08-10T12:00:00.000Z",
      alreadyApplied: true,
    });

    expect(from.mock.calls.map(([table]) => table)).toEqual([
      "guests",
      "guests",
      "guest_merge_events",
    ]);
    expect(rpc).toHaveBeenCalledWith("service_merge_guests", {
      p_request_id: ids.request,
      p_organization_id: ids.organization,
      p_location_id: ids.location,
      p_source_guest_id: ids.source,
      p_target_guest_id: ids.target,
      p_match_score: 0.99,
      p_reasons: ["Reviewed duplicate"],
    });
  });
});
