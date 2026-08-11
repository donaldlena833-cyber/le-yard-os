import { describe, expect, it, vi } from "vitest";
import { throwDatabaseError } from "@/data/errors";
import type { WorkflowContext } from "@/data/execute";
import {
  cancelReservationInputSchema,
  modifyReservationInputSchema,
  reservationLifecycleHeadSchema,
  reservationLifecycleRpcResultSchema,
  saveReservationInputSchema,
  transitionReservationInputSchema,
} from "@/data/reservation-schemas";
import {
  cancelReservation,
  loadReservationLifecycleHead,
  modifyReservation,
} from "@/data/workflows/reservations";

vi.mock("server-only", () => ({}));

const ids = {
  location: "30000000-0000-4000-8000-000000000001",
  reservation: "50000000-0000-4000-8000-000000000001",
  request: "60000000-0000-4000-8000-000000000001",
  revision: "70000000-0000-4000-8000-000000000001",
};

const modifyInput = {
  requestId: ids.request,
  locationId: ids.location,
  reservationId: ids.reservation,
  expectedVersion: 4,
  reservedAt: "2026-08-11T23:30:00.000Z",
  durationMinutes: 90,
  partySize: 4,
  specialRequests: "Window if available",
  tableIds: ["80000000-0000-4000-8000-000000000001"],
  reason: "Guest requested a later arrival.",
};

const lifecycleResult = {
  id: ids.reservation,
  status: "confirmed" as const,
  version: 5,
  reservedAt: "2026-08-11T23:30:00.000Z",
  durationMinutes: 90,
  partySize: 4,
  revisionId: ids.revision,
  revisionKind: "staff_modified" as const,
  policyEvidenceCaptured: true,
  guestNotificationQueued: false,
  replayed: false,
};

function context(result: unknown) {
  const rpc = vi.fn(async () => ({ data: result, error: null }));
  return {
    rpc,
    workflow: {
      supabase: { rpc },
      actor: {
        userId: "10000000-0000-4000-8000-000000000001",
        aal: "aal2",
        memberships: [],
      },
    } as unknown as WorkflowContext,
  };
}

describe("reservation lifecycle application contract", () => {
  it("requires expected-version and staff evidence for modify and cancel", () => {
    expect(modifyReservationInputSchema.safeParse(modifyInput).success).toBe(
      true,
    );
    expect(
      modifyReservationInputSchema.safeParse({
        ...modifyInput,
        expectedVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      modifyReservationInputSchema.safeParse({ ...modifyInput, reason: "no" })
        .success,
    ).toBe(false);
    expect(
      cancelReservationInputSchema.safeParse({
        requestId: ids.request,
        locationId: ids.location,
        reservationId: ids.reservation,
        expectedVersion: 4,
        reason: "Guest called to cancel.",
      }).success,
    ).toBe(true);
  });

  it("closes legacy update and generic cancellation inputs", () => {
    expect(
      saveReservationInputSchema.safeParse({
        ...modifyInput,
        guestId: null,
        source: "manual",
        reservationId: ids.reservation,
      }).success,
    ).toBe(false);
    expect(
      transitionReservationInputSchema.safeParse({
        requestId: ids.request,
        reservationId: ids.reservation,
        targetStatus: "cancelled",
        note: "Legacy path",
      }).success,
    ).toBe(false);
  });

  it("accepts only the bounded browser result projection", () => {
    expect(reservationLifecycleRpcResultSchema.parse(lifecycleResult)).toEqual(
      lifecycleResult,
    );
    expect(
      reservationLifecycleRpcResultSchema.safeParse({
        ...lifecycleResult,
        policyHash: "a".repeat(64),
        beforeState: { guestEmail: "guest@example.com" },
      }).success,
    ).toBe(false);
  });

  it("calls the modify RPC with no guest, source, or provider fields", async () => {
    const { workflow, rpc } = context(lifecycleResult);

    await expect(modifyReservation(workflow, modifyInput)).resolves.toEqual(
      lifecycleResult,
    );
    expect(rpc).toHaveBeenCalledWith("modify_reservation", {
      p_request_id: ids.request,
      p_location_id: ids.location,
      p_reservation_id: ids.reservation,
      p_expected_version: 4,
      p_reserved_at: modifyInput.reservedAt,
      p_duration_minutes: 90,
      p_party_size: 4,
      p_special_requests: "Window if available",
      p_table_ids: modifyInput.tableIds,
      p_reason: "Guest requested a later arrival.",
    });
  });

  it("calls the dedicated cancellation RPC and returns immutable replay evidence", async () => {
    const replay = {
      ...lifecycleResult,
      status: "cancelled" as const,
      durationMinutes: null,
      revisionKind: "staff_cancelled" as const,
      replayed: true,
    };
    const { workflow, rpc } = context(replay);

    await expect(
      cancelReservation(workflow, {
        requestId: ids.request,
        locationId: ids.location,
        reservationId: ids.reservation,
        expectedVersion: 4,
        reason: "Guest called to cancel.",
      }),
    ).resolves.toEqual(replay);
    expect(rpc).toHaveBeenCalledWith("cancel_reservation", {
      p_request_id: ids.request,
      p_location_id: ids.location,
      p_reservation_id: ids.reservation,
      p_expected_version: 4,
      p_reason: "Guest called to cancel.",
    });
  });

  it("loads only the bounded exact lifecycle head", async () => {
    const head = {
      id: ids.reservation,
      version: 6,
      reservedAt: "2026-08-13T23:00:00.000Z",
      durationMinutes: null,
      partySize: 4,
      status: "confirmed" as const,
      tableIds: [],
      specialRequests: null,
      source: "manual",
      bookingChannel: "staff",
      policyEvidenceCaptured: true,
      lastRevision: null,
    };
    expect(reservationLifecycleHeadSchema.parse(head)).toEqual(head);
    const { workflow, rpc } = context(head);

    await expect(
      loadReservationLifecycleHead(workflow, {
        locationId: ids.location,
        reservationId: ids.reservation,
      }),
    ).resolves.toEqual(head);
    expect(rpc).toHaveBeenCalledWith("service_reservation_lifecycle_head", {
      p_location_id: ids.location,
      p_reservation_id: ids.reservation,
    });
  });

  it("classifies stale and allocation conflicts without message matching", () => {
    expect(() => throwDatabaseError({ code: "40001" })).toThrowError(
      expect.objectContaining({
        code: "stale",
        message:
          "This record changed while you were working. Review the latest details before trying again.",
      }),
    );
    expect(() => throwDatabaseError({ code: "23P01" })).toThrowError(
      expect.objectContaining({
        code: "conflict",
        message:
          "This request conflicts with another active commitment. Review the latest details before trying again.",
      }),
    );
  });

  it("rejects an unverified post-commit response without exposing it", async () => {
    const { workflow } = context({
      ...lifecycleResult,
      beforeState: { guestEmail: "guest@example.com" },
    });

    await expect(modifyReservation(workflow, modifyInput)).rejects.toMatchObject(
      {
        code: "database",
        message: expect.stringMatching(/evidence could not be verified/i),
      },
    );
  });
});
