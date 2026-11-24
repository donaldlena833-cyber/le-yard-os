import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  session: vi.fn(), verifyScope: vi.fn(), invoice: vi.fn(), configuration: vi.fn(),
  saveLog: vi.fn(), serviceDay: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mock.session }));
vi.mock("@/data/execute", () => ({
  executeWorkflowAction: async (options: {
    input: unknown; persists?: boolean;
    schema: { parse: (data: unknown) => unknown };
    run: (context: { actor: { userId: string } }, data: unknown) => Promise<unknown>;
  }) => {
    try {
      const data = await options.run({ actor: { userId: "church-staff" } }, options.schema.parse(options.input));
      return { ok: true, persisted: options.persists ?? true, mode: "live", data };
    } catch (error) {
      return { ok: false, persisted: false, message: (error as Error).message };
    }
  },
}));
vi.mock("@/data/read-models/church-square-order-window.server", () => ({
  verifyChurchSquareOrderWindowScope: mock.verifyScope,
}));
vi.mock("@/data/read-models/service-day-context", () => ({ loadLiveServiceDayContext: mock.serviceDay }));
vi.mock("@/data/workflows/service-control", () => ({ saveManagerLog: mock.saveLog }));
vi.mock("@/lib/integrations/church-square-orders.server", () => ({
  churchSquareOrderConfiguration: mock.configuration,
  ChurchSquareOrderClient: class { get = mock.invoice; },
}));

import {
  lookupChurchSquareCateringInvoiceAction,
  saveChurchSquareCateringHandoffAction,
} from "@/app/actions/workflows/church-square-catering";

const updatedAt = "2026-11-14T12:00:00Z";
const invoiceId = "inv:private-8258841286";
const workspace = {
  identity: { userId: "church-staff" }, activeLocation: { id: "church-location" },
  capabilities: ["reports.financial.view", "manager_log.manage"],
};
const handoff = { requestId: "30000000-0000-4000-8000-000000000001", invoiceId, invoiceUpdatedAt: updatedAt };

beforeEach(() => {
  vi.resetAllMocks();
  mock.session.mockResolvedValue({ status: "ready", context: workspace });
  mock.verifyScope.mockResolvedValue(true);
  mock.configuration.mockReturnValue({ locationId: "square-church" });
  mock.invoice.mockResolvedValue({
    id: invoiceId, orderId: "private-0123456789", serviceDate: "2026-12-10", updatedAt,
    status: "PARTIALLY_PAID", deposit: { state: "satisfied", dueCents: 2000, completedCents: 2000 },
    internalContact: "private@example.invalid",
  });
  mock.serviceDay.mockResolvedValue({ ok: true, data: { businessDate: "2026-11-14" } });
  mock.saveLog.mockResolvedValue({ id: "manager-log-1" });
});

describe("Church Street catering invoice review", () => {
  it("returns allowlisted invoice evidence and leaves the log untouched on lookup", async () => {
    const result = await lookupChurchSquareCateringInvoiceAction({ invoiceId });
    expect(result).toEqual({
      ok: true, persisted: false, mode: "live",
      data: {
        invoiceReference: "8258841286", orderReference: "0123456789",
        serviceDate: "2026-12-10", updatedAt, status: "PARTIALLY_PAID",
        deposit: { state: "satisfied", dueCents: 2000, completedCents: 2000 },
        canLog: true,
      },
    });
    expect(mock.invoice).toHaveBeenCalledWith("invoice", invoiceId);
    expect(mock.saveLog).not.toHaveBeenCalled();
  });

  it("scopes both lookups and writes and rechecks the verified invoice before saving", async () => {
    const invalid = await lookupChurchSquareCateringInvoiceAction({ invoiceId, locationId: "other" });
    expect(invalid.ok).toBe(false);
    mock.verifyScope.mockResolvedValueOnce(false);
    const forbidden = await saveChurchSquareCateringHandoffAction(handoff);
    expect(forbidden.ok).toBe(false);
    expect(mock.invoice).not.toHaveBeenCalled();
    expect(mock.saveLog).not.toHaveBeenCalled();

    const stale = await saveChurchSquareCateringHandoffAction({
      ...handoff, invoiceUpdatedAt: "2026-11-13T12:00:00Z",
    });
    expect(stale.ok).toBe(false);
    expect(mock.saveLog).not.toHaveBeenCalled();
  });

  it("saves an idempotent human review handoff with current scoped evidence", async () => {
    const result = await saveChurchSquareCateringHandoffAction(handoff);
    expect(result).toMatchObject({ ok: true, persisted: true, data: { id: "manager-log-1" } });
    expect(mock.saveLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      requestId: handoff.requestId, locationId: "church-location", businessDate: "2026-11-14",
      status: "needs_follow_up", narrative: expect.stringContaining("Observed deposit state satisfied"),
    }));
    const saved = mock.saveLog.mock.lastCall?.[1].narrative;
    expect(saved).toContain("2026-12-10");
    expect(saved).toContain("8258841286");
    expect(saved).not.toContain(invoiceId);
    expect(mock.revalidate).toHaveBeenCalledWith("/service");
  });
});
