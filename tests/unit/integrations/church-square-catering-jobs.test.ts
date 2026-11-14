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
  saveChurchSquareCateringProductionPlanAction,
  updateChurchSquareCateringJobAction,
} from "@/app/actions/workflows/church-square-catering-jobs";
import { emptyCateringPrepPortions } from "@/lib/integrations/church-square-catering-jobs";

const jobId = "30000000-0000-4000-8000-000000000001";
const requestId = "30000000-0000-4000-8000-000000000002";
const invoiceId = "inv:complete-verification-id";
const invoiceUpdatedAt = "2026-11-14T16:00:00.123456Z";
const job = {
  id: jobId, title: "Studio lunch", serviceDate: "2026-12-10", stage: "inquiry", ownerName: "Manager",
  revision: 1, updatedAt: "2026-11-14T16:00:00Z", invoice: null,
  portions: emptyCateringPrepPortions, prepPublishedAt: null,
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

  it("saves the six Church Street quantities as an editable draft or explicit Kitchen publication", async () => {
    const portions = { ...emptyCateringPrepPortions, parisien: 12, figaro: 2_000 };
    const input = { requestId, jobId, expectedRevision: 4, portions };
    mocks.userRpc.mockReturnValueOnce(response({ ...job, portions, revision: 5 }))
      .mockReturnValueOnce(response({ ...job, stage: "confirmed", portions, revision: 6, prepPublishedAt: invoiceUpdatedAt }));
    expect(await saveChurchSquareCateringProductionPlanAction({ ...input, publish: false })).toMatchObject({
      ok: true, persisted: true, data: { portions, revision: 5, prepPublishedAt: null },
    });
    const publishRequestId = "30000000-0000-4000-8000-000000000003";
    expect(await saveChurchSquareCateringProductionPlanAction({ ...input, requestId: publishRequestId, expectedRevision: 5, publish: true })).toMatchObject({
      ok: true, persisted: true, data: { portions, revision: 6, prepPublishedAt: invoiceUpdatedAt },
    });
    const rpcInput = {
      p_request_id: requestId, p_job_id: jobId, p_location_id: "church", p_portions: portions,
    };
    expect(mocks.userRpc).toHaveBeenNthCalledWith(1, "save_church_catering_prep", {
      ...rpcInput, p_expected_revision: 4, p_publish: false,
    });
    expect(mocks.userRpc).toHaveBeenNthCalledWith(2, "save_church_catering_prep", {
      ...rpcInput, p_request_id: publishRequestId, p_expected_revision: 5, p_publish: true,
    });
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
    expect(mocks.getInvoice).not.toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith("/kitchen");
  });

  it("accepts replays of jobs saved before prep planning without adding a publication", async () => {
    const legacyJob = { ...job, portions: undefined, prepPublishedAt: undefined };
    mocks.userRpc.mockReturnValueOnce(response(legacyJob));
    expect(await createChurchSquareCateringJobAction({
      requestId, title: job.title, serviceDate: job.serviceDate, stage: job.stage,
    })).toMatchObject({
      ok: true, data: { portions: emptyCateringPrepPortions, prepPublishedAt: null },
    });
  });

  it("rejects incomplete, extra, fractional, excessive, empty publication, and foreign-scope quantities", async () => {
    const input = { requestId, jobId, expectedRevision: 4, portions: emptyCateringPrepPortions, publish: false };
    const { bleu: omitted, ...incomplete } = emptyCateringPrepPortions;
    expect(omitted).toBe(0);
    for (const portions of [
      incomplete, { ...input.portions, surprise: 1 }, { ...input.portions, bleu: 0.5 }, { ...input.portions, bleu: 2_001 },
    ]) {
      expect(await saveChurchSquareCateringProductionPlanAction({ ...input, portions })).toMatchObject({ ok: false });
    }
    expect(await saveChurchSquareCateringProductionPlanAction({ ...input, publish: true })).toMatchObject({ ok: false });
    expect(await saveChurchSquareCateringProductionPlanAction({ ...input, locationId: "foreign" })).toMatchObject({ ok: false });
    mocks.scope.mockResolvedValueOnce(false);
    expect(await saveChurchSquareCateringProductionPlanAction(input)).toMatchObject({ ok: false });
    expect(mocks.userRpc).not.toHaveBeenCalled();
  });
});
