// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChurchBatchBoard } from "@/components/kitchen/church-batch-board";
import {
  churchBatchBoardPath, churchBatchBoardScopeHeader, churchBatchBoardScopeValue,
  type ChurchBatchBoardScope, type ChurchBatchBoardSnapshot,
} from "@/lib/kitchen/church-batch-board";

vi.mock("@/components/kitchen/church-batch-labels-panel", () => ({
  ChurchBatchLabelsPanel: ({ asOf, canRecord, canPrint = true }: { asOf: string; canRecord: boolean; canPrint?: boolean }) => (
    <section aria-label="Mock batch panel">
      <time dateTime={asOf}>{asOf}</time>
      <button type="button" disabled={!canRecord}>Record batch outcome</button>
      <button type="button" disabled={!canRecord || !canPrint}>Print batch label</button>
    </section>
  ),
}));

const scope: ChurchBatchBoardScope = {
  organizationId: "77777777-7777-4777-8777-777777777771",
  locationId: "77777777-7777-4777-8777-777777777772",
  userId: "77777777-7777-4777-8777-777777777773",
};
const originalTime = "2026-11-14T18:00:00Z";
const pollTime = "2026-11-14T18:00:30Z";
const serverTime = "2026-11-14T18:00:50Z";
const resumeTime = "2026-11-14T18:01:00Z";

function snapshot(checkedAt: string, override?: Partial<ChurchBatchBoardScope>): ChurchBatchBoardSnapshot {
  return { ...scope, ...override, checkedAt, evidence: [], records: [], queue: { batches: [], total: 0 } };
}

function panel() {
  return within(screen.getByRole("region", { name: "Mock batch panel" }));
}

function recordedTime() {
  return panel().getByText(/2026-11-14/).getAttribute("datetime");
}

function writeDisabled() {
  return panel().getByRole<HTMLButtonElement>("button", { name: "Record batch outcome" }).disabled;
}

function printDisabled() {
  return panel().getByRole<HTMLButtonElement>("button", { name: "Print batch label" }).disabled;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("polls every 30 seconds and resumes after a hidden page without overriding newer server props", async () => {
  vi.useFakeTimers({ toFake: ["performance", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(snapshot(pollTime)))
    .mockResolvedValueOnce(Response.json(snapshot(resumeTime)));
  vi.stubGlobal("fetch", fetch);

  const view = render(<ChurchBatchBoard scope={scope} initial={snapshot(originalTime)} canRecord />);
  expect(recordedTime()).toBe(originalTime);
  expect(writeDisabled()).toBe(false);
  expect(printDisabled()).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(fetch).toHaveBeenCalledExactlyOnceWith(churchBatchBoardPath, expect.objectContaining({
    cache: "no-store", credentials: "same-origin", redirect: "manual", signal: expect.any(AbortSignal),
    headers: { [churchBatchBoardScopeHeader]: churchBatchBoardScopeValue(scope) },
  }));
  expect(recordedTime()).toBe(pollTime);

  view.rerender(<ChurchBatchBoard scope={scope} initial={snapshot(serverTime)} canRecord />);
  expect(recordedTime()).toBe(serverTime);

  act(() => {
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(writeDisabled()).toBe(false);
  expect(printDisabled()).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(fetch).toHaveBeenCalledTimes(1);

  await act(async () => {
    visibility.mockReturnValue("visible");
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(recordedTime()).toBe(resumeTime);
  expect(writeDisabled()).toBe(false);
  expect(printDisabled()).toBe(false);
});

it("retains the last board and action drafts during failure, pauses printing, and checks again on reconnect", async () => {
  vi.useFakeTimers({ toFake: ["performance", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json(snapshot(resumeTime)));
  vi.stubGlobal("fetch", fetch);
  render(<ChurchBatchBoard scope={scope} initial={snapshot(originalTime)} canRecord />);

  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(recordedTime()).toBe(originalTime);
  expect(writeDisabled()).toBe(false);
  expect(printDisabled()).toBe(true);
  expect(screen.getByRole("status").textContent).toMatch(/could not refresh.*Last checked/);

  act(() => {
    onLine.mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
  });
  expect(writeDisabled()).toBe(false);
  expect(printDisabled()).toBe(true);
  await act(async () => {
    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(recordedTime()).toBe(resumeTime);
  expect(writeDisabled()).toBe(false);
  expect(printDisabled()).toBe(false);
});

it("clears the prior view on a successful response for a different operator", async () => {
  const request = Promise.withResolvers<Response>();
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(request.promise));
  render(<ChurchBatchBoard scope={scope} initial={snapshot(originalTime)} canRecord />);
  expect(writeDisabled()).toBe(false);
  act(() => window.dispatchEvent(new Event("focus")));
  await act(async () => { request.resolve(Response.json(snapshot(pollTime, { userId: scope.locationId }))); });

  expect(screen.queryByRole("region", { name: "Mock batch panel" })).toBeNull();
  expect(screen.getByRole("status").textContent).toMatch(/Batch board access changed/);
});

it("reads immediately when server data is missing and keeps a read-only operator read-only", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(snapshot(pollTime)));
  vi.stubGlobal("fetch", fetch);
  render(<ChurchBatchBoard scope={scope} initial={null} canRecord={false} />);
  expect(screen.getByRole("status").textContent).toMatch(/Checking the batch board/);
  expect(fetch).toHaveBeenCalledTimes(1);
  await screen.findByRole("region", { name: "Mock batch panel" });
  expect(recordedTime()).toBe(pollTime);
  expect(writeDisabled()).toBe(true);
});
