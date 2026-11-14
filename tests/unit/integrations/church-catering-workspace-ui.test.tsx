// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  attachChurchSquareCateringInvoiceAction,
  createChurchSquareCateringJobAction,
  detachChurchSquareCateringInvoiceAction,
  saveChurchSquareCateringProductionPlanAction,
  updateChurchSquareCateringJobAction,
} from "@/app/actions/workflows/church-square-catering-jobs";
import { lookupChurchSquareCateringInvoiceAction } from "@/app/actions/workflows/church-square-catering";
import { ChurchCateringWorkspace } from "@/components/catering/church-catering-workspace";
import { emptyCateringPrepPortions, type CateringJob } from "@/lib/integrations/church-square-catering-jobs";

vi.mock("@/app/actions/workflows/church-square-catering-jobs", () => ({
  attachChurchSquareCateringInvoiceAction: vi.fn(),
  createChurchSquareCateringJobAction: vi.fn(),
  detachChurchSquareCateringInvoiceAction: vi.fn(),
  listChurchSquareCateringJobsAction: vi.fn(),
  saveChurchSquareCateringProductionPlanAction: vi.fn(),
  updateChurchSquareCateringJobAction: vi.fn(),
}));
vi.mock("@/app/actions/workflows/church-square-catering", () => ({
  lookupChurchSquareCateringInvoiceAction: vi.fn(),
}));

const job: CateringJob = {
  id: "019385e1-91d3-7413-9dc7-dc5ff2a89653", title: "December lunch", serviceDate: "2026-12-15",
  stage: "inquiry", revision: 1, ownerName: "Shift manager", updatedAt: "2026-11-14T15:45:00Z", invoice: null,
  portions: emptyCateringPrepPortions, prepPublishedAt: null,
};
const invoice: NonNullable<CateringJob["invoice"]> = {
  invoiceReference: "invoice42", orderReference: "order42", status: "PARTIALLY_PAID", serviceDate: job.serviceDate,
  updatedAt: job.updatedAt, serviceDateMismatch: false, linkNeedsReview: false,
  deposit: { state: "satisfied", dueCents: 5000, completedCents: 5000 },
};
const saved = (data: CateringJob) => ({ ok: true, mode: "live", persisted: true, data } as const);
const verified = (serviceDate: string) => ({ ok: true, mode: "live", persisted: false, data: { ...invoice, serviceDate, canLog: false } } as const);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});

it("creates a durable inquiry and advances its stage using the saved revision", async () => {
  vi.mocked(createChurchSquareCateringJobAction).mockResolvedValue(saved(job));
  vi.mocked(updateChurchSquareCateringJobAction).mockResolvedValue(saved({ ...job, stage: "quoted", revision: 2 }));
  render(<ChurchCateringWorkspace initialJobs={[]} />);
  const create = within(screen.getByRole("region", { name: "New catering job" }));
  fireEvent.change(create.getByLabelText("Internal event name"), { target: { value: job.title } });
  fireEvent.change(create.getByLabelText("Service date"), { target: { value: job.serviceDate } });
  fireEvent.click(create.getByRole("button", { name: "Create inquiry" }));
  const card = within(await screen.findByRole("article", { name: job.title }));
  expect(card.getByText(/Owner Shift manager/)).toBeTruthy();
  expect(createChurchSquareCateringJobAction).toHaveBeenCalledWith(expect.objectContaining({
    requestId: expect.any(String), title: job.title, serviceDate: job.serviceDate, stage: "inquiry",
  }));
  fireEvent.click(card.getByText("Edit job"));
  fireEvent.change(card.getByLabelText("Stage"), { target: { value: "quoted" } });
  fireEvent.click(card.getByRole("button", { name: "Save job" }));
  await waitFor(() => expect(card.getByText(/Quoted · Owner/)).toBeTruthy());
  expect(updateChurchSquareCateringJobAction).toHaveBeenCalledWith(expect.objectContaining({
    requestId: expect.any(String), jobId: job.id, expectedRevision: 1, stage: "quoted",
  }));
});

it("fences attachments behind matching verification, handles stale evidence, and detaches only on confirmation", async () => {
  vi.mocked(lookupChurchSquareCateringInvoiceAction)
    .mockResolvedValueOnce(verified("2026-12-16"))
    .mockResolvedValue(verified(job.serviceDate));
  vi.mocked(attachChurchSquareCateringInvoiceAction)
    .mockResolvedValueOnce({ ok: false, persisted: false, code: "stale", message: "Verify the invoice again." })
    .mockResolvedValueOnce(saved({ ...job, revision: 2, invoice }));
  vi.mocked(detachChurchSquareCateringInvoiceAction).mockResolvedValue(saved({ ...job, revision: 3 }));
  render(<ChurchCateringWorkspace initialJobs={[job]} />);
  const card = within(screen.getByRole("article", { name: job.title }));
  fireEvent.click(card.getByText("Verify and attach invoice"));
  const invoiceId = card.getByLabelText("Exact Square invoice ID");
  fireEvent.change(invoiceId, { target: { value: "inv:full-invoice42" } });
  fireEvent.click(card.getByRole("button", { name: "Verify invoice" }));
  expect((await card.findByRole("button", { name: "Attach verified invoice" }) as HTMLButtonElement).disabled).toBe(true);
  expect(card.getByText(/service date must match/)).toBeTruthy();
  expect(attachChurchSquareCateringInvoiceAction).not.toHaveBeenCalled();

  fireEvent.click(card.getByRole("button", { name: "Verify invoice" }));
  await waitFor(() => expect((card.getByRole("button", { name: "Attach verified invoice" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(card.getByRole("button", { name: "Attach verified invoice" }));
  await card.findByText("Verify the invoice again.");
  expect(card.queryByRole("button", { name: "Attach verified invoice" })).toBeNull();
  fireEvent.click(card.getByRole("button", { name: "Verify invoice" }));
  fireEvent.click(await card.findByRole("button", { name: "Attach verified invoice" }));
  await card.findByText("Verified invoice attached to this job.");
  expect(attachChurchSquareCateringInvoiceAction).toHaveBeenLastCalledWith(expect.objectContaining({
    jobId: job.id, expectedRevision: 1, invoiceId: "inv:full-invoice42", invoiceUpdatedAt: invoice.updatedAt,
  }));
  expect(card.getByText("Square records the requested deposit as paid", { exact: false })).toBeTruthy();
  fireEvent.click(card.getByText("Edit job"));
  expect((card.getByLabelText("Service date") as HTMLInputElement).disabled).toBe(true);

  fireEvent.click(card.getByRole("button", { name: "Detach invoice" }));
  const confirm = within(await screen.findByRole("alertdialog"));
  expect(detachChurchSquareCateringInvoiceAction).not.toHaveBeenCalled();
  fireEvent.click(confirm.getByRole("button", { name: "Detach invoice" }));
  await card.findByText("No Square invoice attached.");
  expect(detachChurchSquareCateringInvoiceAction).toHaveBeenCalledWith(expect.objectContaining({
    requestId: expect.any(String), jobId: job.id, expectedRevision: 2, expectedInvoiceReference: invoice.invoiceReference,
  }));
});

it("saves six named portions as a manager draft and requires a confirmed job for handoff", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-15T02:00:00Z"));
  const portions = { ...job.portions, parisien: 12, bleu: 5 };
  vi.mocked(saveChurchSquareCateringProductionPlanAction).mockResolvedValue(saved({ ...job, portions, revision: 2 }));
  render(<ChurchCateringWorkspace initialJobs={[job]} />);
  const card = within(screen.getByRole("article", { name: job.title }));
  fireEvent.click(card.getByText(/Kitchen portions/));
  expect(card.getAllByRole("spinbutton")).toHaveLength(6);
  fireEvent.change(card.getByRole("spinbutton", { name: "Le Parisien" }), { target: { value: "12" } });
  fireEvent.change(card.getByRole("spinbutton", { name: "Le Bleu" }), { target: { value: "5" } });
  expect((card.getByRole("button", { name: "Publish to Kitchen" }) as HTMLButtonElement).disabled).toBe(true);
  expect(card.getByText("Confirm the job before publishing to Kitchen.")).toBeTruthy();
  fireEvent.click(card.getByRole("button", { name: "Save portion draft" }));
  await card.findByText("Portion draft saved.");
  expect(card.getByText("Kitchen portions · 17 in draft")).toBeTruthy();
  expect(saveChurchSquareCateringProductionPlanAction).toHaveBeenCalledWith(expect.objectContaining({
    requestId: expect.any(String), jobId: job.id, expectedRevision: 1, portions, publish: false,
  }));
});

it("publishes a confirmed job, then removes the handoff when revised quantities are saved as a draft", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // December 15 in UTC is still December 14 at Church Street.
  vi.setSystemTime(new Date("2026-12-15T02:00:00Z"));
  const activeJob: CateringJob = { ...job, serviceDate: "2026-12-14", stage: "confirmed" };
  const portions = { ...job.portions, figaro: 8 };
  const published: CateringJob = { ...activeJob, portions, revision: 2, prepPublishedAt: "2026-12-15T02:00:01Z" };
  vi.mocked(saveChurchSquareCateringProductionPlanAction)
    .mockResolvedValueOnce(saved(published))
    .mockResolvedValueOnce(saved({ ...published, portions: { ...portions, figaro: 6 }, revision: 3, prepPublishedAt: null }));
  render(<ChurchCateringWorkspace initialJobs={[activeJob]} />);
  const card = within(screen.getByRole("article", { name: job.title }));
  fireEvent.click(card.getByText(/Kitchen portions/));
  const publish = card.getByRole("button", { name: "Publish to Kitchen" }) as HTMLButtonElement;
  expect(publish.disabled).toBe(true);
  fireEvent.change(card.getByRole("spinbutton", { name: "Le Figaro" }), { target: { value: "2001" } });
  expect(publish.disabled).toBe(true);
  fireEvent.change(card.getByRole("spinbutton", { name: "Le Figaro" }), { target: { value: "8" } });
  expect(publish.disabled).toBe(false);
  fireEvent.click(publish);
  await card.findByText("Portions published to Kitchen.");
  expect(card.getByText("Kitchen portions · 8 published")).toBeTruthy();
  expect(saveChurchSquareCateringProductionPlanAction).toHaveBeenCalledWith(expect.objectContaining({
    jobId: job.id, expectedRevision: 1, portions, publish: true,
  }));
  fireEvent.change(card.getByRole("spinbutton", { name: "Le Figaro" }), { target: { value: "6" } });
  expect(card.getByText(/removes the current Kitchen handoff/)).toBeTruthy();
  fireEvent.click(card.getByRole("button", { name: "Save portion draft" }));
  await card.findByText("Kitchen portions · 6 in draft");
  expect(card.queryByText(/Published to Kitchen/)).toBeNull();
  expect(saveChurchSquareCateringProductionPlanAction).toHaveBeenLastCalledWith(expect.objectContaining({
    jobId: job.id, expectedRevision: 2, portions: { ...portions, figaro: 6 }, publish: false,
  }));
});
