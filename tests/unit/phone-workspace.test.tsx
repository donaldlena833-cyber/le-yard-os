// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => Response.json(model)),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
  fireEvent.click(screen.getByRole("button", { name: "Messages" }));
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

it("keeps the selected founder when moving between messages and the callback keypad", async () => {
  render(<PhoneWorkspace live defaultStaff="donald" />);
  await waitFor(() => expect(screen.getByText(/Updated/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Maris/ }));
  fireEvent.click(screen.getByRole("button", { name: "Messages" }));
  fireEvent.click(screen.getByRole("button", { name: "Keypad" }));
  expect(
    screen.getByRole("button", { name: /Maris/ }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.change(screen.getByLabelText("Number to call"), {
    target: { value: "(212) 555-0123" },
  });
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ status: "queued" }, { status: 201 }),
  );
  fireEvent.click(screen.getByLabelText("Call from Le Yard"));
  await waitFor(() =>
    expect(screen.getByText(/Your cellphone will ring/)).toBeTruthy(),
  );
  const requests = vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method === "POST");
  expect(requests).toHaveLength(1);
  expect(JSON.parse(requests[0][1]!.body as string)).toMatchObject({
    action: "call",
    staff: "maris",
    to: "+12125550123",
  });
});

it("searches conversations, opens the matching thread, and prepares a call without placing it", async () => {
  const messages = [
    {
      sid: "SMreservation",
      from: "+12125550123",
      to: model.business,
      body: "Reservation for Friday",
      status: "received",
      direction: "inbound",
      at: "2026-09-07T12:00:00Z",
      mediaCount: 0,
      errorCode: null,
    },
    {
      sid: "SMdelivery",
      from: "+16465550123",
      to: model.business,
      body: "Delivery at noon",
      status: "received",
      direction: "inbound",
      at: "2026-09-07T13:00:00Z",
      mediaCount: 0,
      errorCode: null,
    },
  ];
  vi.mocked(fetch).mockImplementation(async (input) => {
    const phone = new URL(
      String(input),
      "https://phone.leyardny.com",
    ).searchParams.get("phone");
    return Response.json({
      ...model,
      messages: phone
        ? messages.filter((message) => message.from === phone)
        : messages,
    });
  });
  render(<PhoneWorkspace live defaultStaff="maris" />);
  await waitFor(() => expect(screen.getByText(/Updated/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Messages" }));
  const conversations = within(screen.getByLabelText("Conversations"));
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search conversations" }),
    { target: { value: "(212) 555-0123" } },
  );
  expect(conversations.getByText("Reservation for Friday")).toBeTruthy();
  expect(conversations.queryByText("Delivery at noon")).toBeNull();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search conversations" }),
    { target: { value: "reservation" } },
  );
  expect(conversations.queryByText("Delivery at noon")).toBeNull();
  fireEvent.click(
    conversations.getByRole("button", { name: /Reservation for Friday/ }),
  );
  const thread = within(screen.getByLabelText("Selected conversation"));
  expect(await thread.findByText("Reservation for Friday")).toBeTruthy();
  expect(thread.queryByText("Delivery at noon")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Call this contact" }));
  expect(
    (screen.getByLabelText("Number to call") as HTMLInputElement).value,
  ).toBe("+12125550123");
  expect(
    vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "POST"),
  ).toBe(false);
});

it("sends explicit new-conversation consent and reuses the request ID when delivery is uncertain", async () => {
  const requests: Record<string, unknown>[] = [];
  vi.mocked(fetch).mockImplementation(async (_input, init) => {
    if (init?.method === "POST") {
      requests.push(JSON.parse(init.body as string));
      return Response.json({
        status: requests.length === 1 ? "uncertain" : "queued",
      });
    }
    return Response.json(model);
  });
  render(<PhoneWorkspace live defaultStaff="donald" />);
  await waitFor(() => expect(screen.getByText(/Updated/)).toBeTruthy());
  fireEvent.click(
    screen.getByRole("button", { name: "Compose a new message" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Phone number" }), {
    target: { value: "(212) 555-0123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.getByLabelText("Message")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Your table request is confirmed." },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /recipient agreed/ }));
  fireEvent.click(screen.getByRole("button", { name: "Send text" }));
  expect(
    await screen.findByText(/This request is still being checked/),
  ).toBeTruthy();
  expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
    "Your table request is confirmed.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Send text" }));
  expect(await screen.findByText(/Text queued/)).toBeTruthy();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({
    action: "sms",
    to: "+12125550123",
    body: "Your table request is confirmed.",
    consent: true,
  });
  expect(requests[0].requestId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(requests[1]).toEqual(requests[0]);
  expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
    "",
  );
});

it("restores saved appearance and keeps a changed choice after remounting", async () => {
  localStorage.setItem("le-yard-phone-appearance", "dark");
  const first = render(<PhoneWorkspace live={false} defaultStaff="donald" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Switch to light appearance" }),
  );
  expect(localStorage.getItem("le-yard-phone-appearance")).toBe("light");
  expect(screen.getByRole("main").getAttribute("data-theme")).toBe("light");
  first.unmount();
  // An explicit light choice must also survive when the OS prefers dark.
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  render(<PhoneWorkspace live defaultStaff="donald" />);
  await waitFor(() => expect(screen.getByText(/Updated/)).toBeTruthy());
  expect(screen.getByRole("main").getAttribute("data-theme")).toBe("light");
  expect(
    screen.getByRole("button", { name: "Switch to dark appearance" }),
  ).toBeTruthy();
});

it("keeps preview mode read-only even when a valid destination is entered", () => {
  render(<PhoneWorkspace live={false} defaultStaff="donald" />);
  fireEvent.change(screen.getByLabelText("Number to call"), {
    target: { value: "2125550123" },
  });
  expect(
    (screen.getByLabelText("Call from Le Yard") as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByLabelText("Message this number"));
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Preview message" },
  });
  expect(
    (screen.getByRole("button", { name: "Send text" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
