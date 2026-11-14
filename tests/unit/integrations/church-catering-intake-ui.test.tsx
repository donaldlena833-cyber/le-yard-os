// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  convertChurchCateringIntakeAction,
  getChurchCateringIntakeAction,
  listChurchCateringIntakeAction,
} from "@/app/actions/workflows/church-catering-intake";
import { ChurchCateringIntake } from "@/components/catering/church-catering-intake";
import type { WorkflowActionResult } from "@/data/types";
import type { ChurchCateringIntakeDetail, ChurchCateringIntakeSummary } from "@/lib/integrations/church-catering-intake";
import { emptyCateringPrepPortions, type CateringJob } from "@/lib/integrations/church-square-catering-jobs";

vi.mock("@/app/actions/workflows/church-catering-intake", () => ({
  convertChurchCateringIntakeAction: vi.fn(),
  getChurchCateringIntakeAction: vi.fn(),
  listChurchCateringIntakeAction: vi.fn(),
}));

const summary: ChurchCateringIntakeSummary = {
  id: "019385e1-91d3-7413-9dc7-dc5ff2a89653", audience: "corporate", eventDate: null,
  guestCount: 15, receivedAt: "2026-11-14T01:30:00Z", source: "website", jobId: null,
};
const detail: ChurchCateringIntakeDetail = {
  ...summary, occasion: "Jamie’s party", contactName: "Jamie Example", email: "jamie@example.test", phone: null,
  company: null, eventTime: null, location: null, format: '<a href="https://example.test">Seated</a>', budget: null,
};
const job: CateringJob = {
  id: "019385e1-91d3-7413-9dc7-dc5ff2a8aabb", title: "December lunch", serviceDate: "2026-12-15",
  stage: "inquiry", revision: 1, ownerName: "Shift manager", updatedAt: "2026-11-14T15:45:00Z", invoice: null,
  portions: emptyCateringPrepPortions, prepPublishedAt: null,
};
const read = <T,>(data: T) => ({ ok: true, mode: "live", persisted: false, data } as const);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("loads contact information only on demand and converts with a checked date and internal event name", async () => {
  vi.mocked(listChurchCateringIntakeAction).mockResolvedValue(read([{ ...summary, occasion: detail.occasion }]));
  vi.mocked(getChurchCateringIntakeAction).mockResolvedValue(read(detail));
  vi.mocked(convertChurchCateringIntakeAction).mockResolvedValue({ ...read(job), persisted: true });
  const onConverted = vi.fn();
  render(<ChurchCateringIntake onConverted={onConverted} />);
  expect(listChurchCateringIntakeAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Load intake" }));
  const row = within(await screen.findByRole("listitem"));
  expect(row.getByText(/Requested date undecided/)).toBeTruthy();
  expect(row.queryByText(detail.occasion)).toBeNull();
  expect(row.queryByText(detail.email)).toBeNull();
  expect(getChurchCateringIntakeAction).not.toHaveBeenCalled();

  fireEvent.click(row.getByRole("button", { name: /View private details/ }));
  expect(await row.findByText(detail.email)).toBeTruthy();
  expect(row.getByText(detail.format!)).toBeTruthy();
  expect(row.queryByRole("link")).toBeNull();
  const date = row.getByLabelText("Service date") as HTMLInputElement;
  expect(date.value).toBe("");
  const title = row.getByLabelText("Internal event name") as HTMLInputElement;
  expect(title.value).toBe("");
  fireEvent.change(title, { target: { value: job.title } });
  fireEvent.click(row.getByRole("button", { name: "Create inquiry job" }));
  expect(convertChurchCateringIntakeAction).not.toHaveBeenCalled();
  fireEvent.change(date, { target: { value: job.serviceDate } });
  fireEvent.click(row.getByRole("button", { name: "Create inquiry job" }));

  await screen.findByText("Catering job created in the Inquiry stage.");
  expect(convertChurchCateringIntakeAction).toHaveBeenCalledWith({
    inquiryId: summary.id, requestId: expect.any(String), title: job.title, serviceDate: job.serviceDate,
  });
  expect(onConverted).toHaveBeenCalledWith(job);
  expect(screen.queryByText(detail.email)).toBeNull();
  expect(row.getByText(/Job created/)).toBeTruthy();
});

it("drops private responses that resolve after closing and clears the overview when access is denied", async () => {
  vi.mocked(listChurchCateringIntakeAction).mockResolvedValue(read([summary]));
  let finishRead!: (result: WorkflowActionResult<ChurchCateringIntakeDetail>) => void;
  vi.mocked(getChurchCateringIntakeAction)
    .mockReturnValueOnce(new Promise((resolve) => { finishRead = resolve; }))
    .mockResolvedValueOnce({ ok: false, code: "forbidden", persisted: false, message: "Access denied" });
  render(<ChurchCateringIntake onConverted={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Load intake" }));
  fireEvent.click(await screen.findByRole("button", { name: /View private details/ }));
  fireEvent.click(screen.getByRole("button", { name: /Close details/ }));
  await act(async () => finishRead(read(detail)));
  expect(screen.queryByText(detail.email)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /View private details/ }));
  await screen.findByText("Church Street catering intake access is required.");
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.queryByText(detail.email)).toBeNull();
});
