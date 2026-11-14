import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), scope: vi.fn(), userRpc: vi.fn(), serviceRpc: vi.fn(),
  config: vi.fn(), getInvoice: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/data/read-models/church-square-order-window.server", () => ({
  verifyChurchSquareOrderWindowScope: mocks.scope,
}));
vi.mock("@/data/execute", () => ({
  executeWorkflowAction: async (options: {
    input: unknown; persists?: boolean; schema: { parse: (data: unknown) => unknown };
    run: (context: { actor: { userId: string }; supabase: { rpc: typeof mocks.userRpc } }, input: unknown) => unknown;
  }) => {
    try {
      const data = await options.run({
        actor: { userId: "operator" }, supabase: { rpc: mocks.userRpc },
      }, options.schema.parse(options.input));
      return { ok: true, persisted: options.persists ?? true, mode: "live", data };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.serviceRpc }) }));
vi.mock("@/lib/integrations/church-square-orders.server", () => ({
  churchSquareOrderConfiguration: mocks.config,
  ChurchSquareOrderClient: class { get = mocks.getInvoice; },
}));

import {
  attachChurchSquareCateringInvoiceAction,
  createChurchSquareCateringJobAction,
  detachChurchSquareCateringInvoiceAction,
  listChurchSquareCateringJobsAction,
  updateChurchSquareCateringJobAction,
} from "@/app/actions/workflows/church-square-catering-jobs";

const jobId = "30000000-0000-4000-8000-000000000001";
const requestId = "30000000-0000-4000-8000-000000000002";
const invoiceId = "inv:complete-verification-id";
const invoiceUpdatedAt = "2026-11-14T16:00:00.123456Z";
const job = {
  id: jobId, title: "Studio lunch", serviceDate: "2026-12-10", stage: "inquiry", ownerName: "Manager",
  revision: 1, updatedAt: "2026-11-14T16:00:00Z", invoice: null,
} as const;
const verifiedInvoice = {
  id: invoiceId, orderId: "provider-order-1234567", serviceDate: job.serviceDate, updatedAt: invoiceUpdatedAt,
  status: "PARTIALLY_PAID", deposit: { state: "satisfied", dueCents: 2000, completedCents: 2000 },
  locationId: "SQUARE_CHURCH", primaryRecipient: "customer-to-strip",
};
function response(data: unknown) {
  return { abortSignal: async () => ({ data, error: null }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ status: "ready", context: { identity: { userId: "operator" }, activeLocation: { id: "church" } } });
  mocks.scope.mockResolvedValue(true);
  mocks.config.mockReturnValue({ merchantId: "MERCHANT", locationId: "SQUARE_CHURCH" });
  mocks.getInvoice.mockResolvedValue(verifiedInvoice);
  mocks.userRpc.mockImplementation((name) => response(name === "list_church_catering_jobs" ? [job] : job));
  mocks.serviceRpc.mockReturnValue(response(job));
});

describe("Church Street catering job actions", () => {
  it("loads and creates with the session location through the authenticated client", async () => {
    expect(await listChurchSquareCateringJobsAction()).toMatchObject({ ok: true, persisted: false, data: [job] });
    const payload = { requestId, title: job.title, serviceDate: job.serviceDate, stage: job.stage };
    expect(await createChurchSquareCateringJobAction({ ...payload, locationId: "another-location" })).toMatchObject({ ok: false });
    expect(await createChurchSquareCateringJobAction(payload)).toMatchObject({ ok: true, persisted: true });
    expect(mocks.userRpc.mock.calls).toEqual([
      ["list_church_catering_jobs", { p_location_id: "church" }],
      ["save_church_catering_job", { p_request_id: requestId, p_location_id: "church",
        p_title: job.title, p_service_date: job.serviceDate, p_stage: "inquiry" }],
    ]);
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it("passes the optimistic revision on updates and rejects non-Church actors", async () => {
    const payload = { requestId, jobId, title: job.title, serviceDate: job.serviceDate, stage: "quoted", expectedRevision: 3 };
    mocks.scope.mockResolvedValueOnce(false);
    expect(await updateChurchSquareCateringJobAction(payload)).toMatchObject({ ok: false });
    expect(mocks.userRpc).not.toHaveBeenCalled();
    await updateChurchSquareCateringJobAction(payload);
    expect(mocks.userRpc).toHaveBeenCalledWith("save_church_catering_job", expect.objectContaining({
      p_job_id: jobId, p_expected_revision: 3, p_stage: "quoted",
    }));
  });

  it("freshly verifies a Square invoice and passes only server evidence to the attachment RPC", async () => {
    const result = await attachChurchSquareCateringInvoiceAction({ requestId, jobId, expectedRevision: 1, invoiceId, invoiceUpdatedAt });
    expect(result).toMatchObject({ ok: true, persisted: true });
    expect(mocks.getInvoice).toHaveBeenCalledWith("invoice", invoiceId);
    expect(mocks.serviceRpc).toHaveBeenCalledWith("service_attach_church_catering_invoice", {
      p_request_id: requestId, p_job_id: jobId, p_expected_revision: 1, p_location_id: "church", p_actor_id: "operator",
      p_merchant_id: "MERCHANT", p_square_location_id: "SQUARE_CHURCH", p_invoice_id: invoiceId,
      p_order_id: verifiedInvoice.orderId, p_invoice_status: "PARTIALLY_PAID", p_invoice_service_date: job.serviceDate,
      p_invoice_updated_at: invoiceUpdatedAt, p_deposit_state: "satisfied", p_deposit_due_cents: 2000, p_deposit_completed_cents: 2000,
    });
    expect(mocks.userRpc).not.toHaveBeenCalled();
  });

  it("avoids linking outdated or undated provider evidence", async () => {
    const payload = { requestId, jobId, expectedRevision: 1, invoiceId, invoiceUpdatedAt };
    mocks.getInvoice.mockResolvedValueOnce({ ...verifiedInvoice, updatedAt: "2026-11-14T16:00:00.123457Z" })
      .mockResolvedValueOnce({ ...verifiedInvoice, serviceDate: null });
    expect(await attachChurchSquareCateringInvoiceAction(payload)).toMatchObject({ ok: false, message: /updated/ });
    expect(await attachChurchSquareCateringInvoiceAction(payload)).toMatchObject({ ok: false, message: /sale or service date/ });
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it("strips unneeded fields and displays provider evidence needing manual review", async () => {
    mocks.userRpc.mockReturnValue(response([{
      ...job, invoice: {
        invoiceReference: "8258841286", orderReference: "0123456789",
        status: "PARTIALLY_REFUNDED", serviceDate: "2026-12-11", updatedAt: invoiceUpdatedAt,
        serviceDateMismatch: true, linkNeedsReview: true,
        deposit: { state: "review_required", dueCents: 1000, completedCents: -10 },
        privateExtras: "customer-data",
      },
    }]));
    const result = await listChurchSquareCateringJobsAction();
    expect(result).toMatchObject({
      ok: true,
      data: [{ invoice: {
        serviceDateMismatch: true, linkNeedsReview: true,
        deposit: { state: "review_required", dueCents: 1000, completedCents: null },
      } }],
    });
    expect(JSON.stringify(result)).not.toContain("customer-data");
  });

  it("detaches the selected invoice inside Operations using the shown reference and job revision", async () => {
    const expectedInvoiceReference = "8258841286";
    const input = { requestId, jobId, expectedRevision: 4, expectedInvoiceReference };
    expect(await detachChurchSquareCateringInvoiceAction(input)).toMatchObject({
      ok: true, persisted: true, data: { invoice: null },
    });
    expect(mocks.userRpc).toHaveBeenCalledWith("detach_church_catering_invoice", {
      p_request_id: requestId, p_job_id: jobId, p_expected_revision: 4, p_location_id: "church",
      p_expected_invoice_reference: expectedInvoiceReference,
    });
    expect(mocks.getInvoice).not.toHaveBeenCalled();
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });
});
