// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChurchSquareClosePreview } from "@/components/closeout/church-square-close-preview";
import { churchSquareClosePreviewPath, type ChurchSquareClosePreviewSnapshot } from "@/lib/integrations/church-square-close-preview";

const props = { locationId: "church-scope", today: "2026-11-14", earliestDate: "2026-11-08" };
const fixture: ChurchSquareClosePreviewSnapshot = {
  date: props.today,
  checkedAt: "2026-11-14T13:42:00Z",
  window: { from: "2026-11-14T05:00:00Z", to: "2026-11-14T13:42:00Z", dayEnded: false },
  payments: { coverage: "complete", observed: 3, completed: 2, unresolved: 1, offline: 1, missingOrder: 1, missingTotal: 0, totalCents: 1475, tipCents: 275 },
  refunds: { coverage: "complete", observed: 2, completed: 2, unresolved: 0, withoutPaymentReference: 1, paymentOutsideRead: 1, amountCents: 300 },
  netActivityCents: 1175,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("loads the requested ET date on demand and labels close activity and reference gaps", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(fixture));
  vi.stubGlobal("fetch", fetchMock);
  render(<ChurchSquareClosePreview {...props} />);
  const date = screen.getByLabelText("Date (ET)");
  expect(date.getAttribute("min")).toBe(props.earliestDate);
  expect(date.getAttribute("max")).toBe(props.today);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Check activity" }));
  expect(await screen.findByText("$14.75")).toBeTruthy();
  expect(screen.getByText("$2.75")).toBeTruthy();
  expect(screen.getByText("$3.00")).toBeTruthy();
  expect(screen.getByText("$11.75")).toBeTruthy();
  expect(screen.getByText(/missing square payment reference/i)).toBeTruthy();
  expect(screen.getByText(/payment outside this read/i)).toBeTruthy();
  expect(screen.getByText(/calendar day is still in progress/i)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toMatch(/8:42 AM ET/);
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${churchSquareClosePreviewPath}?locationId=${props.locationId}&date=${props.today}`,
    expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
});

it("withholds partial totals, retains a known complete refund total, and replaces results on request failure", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ ...fixture, payments: { ...fixture.payments, coverage: "partial" } }))
    .mockResolvedValueOnce(Response.json({ status: "unavailable" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ status: "forbidden" }, { status: 403 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<ChurchSquareClosePreview {...props} />);
  const check = screen.getByRole("button", { name: "Check activity" });
  fireEvent.click(check);
  expect(await screen.findByText(/Partial results/)).toBeTruthy();
  expect(screen.getByText("$3.00")).toBeTruthy();
  expect(screen.queryByText("$14.75")).toBeNull();
  expect(screen.queryByText("$11.75")).toBeNull();
  fireEvent.click(check);
  expect(await screen.findByText(/could not be verified/i)).toBeTruthy();
  expect(screen.queryByText("$3.00")).toBeNull();
  fireEvent.click(check);
  expect(await screen.findByText(/financial reports access is required/i)).toBeTruthy();
});

it("discards an older response on date change and clears the preview on location change", async () => {
  const earlier = "2026-11-13";
  let finishOld: (response: Response) => void = () => {};
  const old = new Promise<Response>((resolve) => { finishOld = resolve; });
  const fetchMock = vi.fn()
    .mockReturnValueOnce(old)
    .mockResolvedValueOnce(Response.json({ ...fixture, date: earlier, window: { ...fixture.window, dayEnded: true }, netActivityCents: -120 }));
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<ChurchSquareClosePreview {...props} />);
  const button = screen.getByRole("button", { name: "Check activity" });
  fireEvent.click(button);
  const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  fireEvent.change(screen.getByLabelText("Date (ET)"), { target: { value: earlier } });
  expect(firstSignal.aborted).toBe(true);
  fireEvent.click(button);
  expect(await screen.findByText("-$1.20")).toBeTruthy();
  await act(async () => finishOld(Response.json(fixture)));
  expect(screen.queryByText("$11.75")).toBeNull();
  view.rerender(<ChurchSquareClosePreview {...props} locationId="other-scope" />);
  expect(screen.queryByText("-$1.20")).toBeNull();
});
