// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PhoneWorkspace } from "@/components/phone/phone-workspace";
const model = {
  business: "+13328779035",
  smsEnabled: true,
  callsEnabled: true,
  messages: [],
  calls: [],
  voicemails: [],
};
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(model)));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("opens a usable keypad and normalizes the destination before starting a call", async () => {
  render(<PhoneWorkspace live defaultStaff="donald" />);
  await waitFor(() => expect(screen.getByText(/Updated/)).toBeTruthy());
  for (const digit of "2125550123")
    fireEvent.click(screen.getByRole("button", { name: digit }));
  expect(
    (screen.getByLabelText("Number to call") as HTMLInputElement).value,
  ).toBe("2125550123");
  fireEvent.click(screen.getByLabelText("Delete last digit"));
  expect(
    (screen.getByLabelText("Number to call") as HTMLInputElement).value,
  ).toBe("212555012");
  fireEvent.click(screen.getByRole("button", { name: "3" }));
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ status: "queued" }, { status: 201 }),
  );
  fireEvent.click(screen.getByLabelText("Call from Le Yard"));
  await waitFor(() =>
    expect(screen.getByText(/Your cellphone will ring/)).toBeTruthy(),
  );
  const request = vi
    .mocked(fetch)
    .mock.calls.find(([, init]) => init?.method === "POST");
  expect(JSON.parse(request![1]!.body as string)).toMatchObject({
    action: "call",
    to: "+12125550123",
    staff: "donald",
  });
});
it("shows a sign-in recovery link for expired sessions instead of endless loading", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ error: "Expired" }, { status: 401 }),
  );
  render(<PhoneWorkspace live defaultStaff="donald" />);
  expect(
    await screen.findByRole("link", { name: "Sign in again" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Messages" }),
  );
  expect(screen.queryByText("Loading shared history…")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("session has ended");
});
it("recovers from a history outage using Retry without showing a false empty state", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: "Unavailable" }, { status: 503 }),
  );
  render(<PhoneWorkspace live defaultStaff="maris" />);
  fireEvent.click(screen.getByRole("button", { name: "Recents" }));
  const retry = await screen.findByRole("button", { name: "Retry" });
  expect(screen.queryByText("No calls in the recent history.")).toBeNull();
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByText("No calls in the recent history.")).toBeTruthy();
});
it("does not allow dialing the business number or an incomplete destination", async () => {
  render(<PhoneWorkspace live defaultStaff="donald" />);
  await waitFor(() => expect(screen.getByText(/Updated/)).toBeTruthy());
  for (const value of ["212", "3328779035"]) {
    fireEvent.change(screen.getByLabelText("Number to call"), {
      target: { value },
    });
    expect(
      (screen.getByLabelText("Call from Le Yard") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  }
});
