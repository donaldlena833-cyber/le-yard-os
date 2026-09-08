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
import { CommunicationGroups } from "@/components/messages/communication-groups";
const sid = "SM" + "a".repeat(32);
const phone = "+12125550123";
const incoming = {
  sid,
  from_number: phone,
  to_number: "+13328779035",
  body: "  Exact client message\nwith a second line.  ",
  direction: "inbound",
  sender_kind: "client",
  audience: "client",
  contact_name: null,
  media_count: 1,
  status: "received",
  error_code: null,
  sent_at: "2026-09-08T12:00:00.000Z",
};
const model = {
  messages: [incoming],
  more: false,
  cases: [],
  notes: [],
  threads: [{ phone, mode: "human", reason: "Agent needs help" }],
};
beforeEach(() => {
  vi.stubGlobal("React", React);
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
it("shows exact text and private MMS links in the aggregate group", async () => {
  render(<CommunicationGroups group="clients" />);
  const history = await screen.findByLabelText("Twilio message history");
  await waitFor(() => expect(history.textContent).toContain(incoming.body));
  expect(
    within(history)
      .getByRole("link", { name: "Open attachment 1" })
      .getAttribute("href"),
  ).toBe(`/api/phone/media?message=${sid}&index=0`);
  expect(
    within(screen.getByLabelText("Twilio conversations")).getByText(
      "Needs a human",
    ),
  ).toBeTruthy();
});
it("sends a human reply only to the selected recipient, never to an aggregate group", async () => {
  render(<CommunicationGroups group="clients" />);
  await screen.findByRole("button", { name: "Open conversation" });
  expect(
    screen.queryByRole("button", { name: "Send SMS from Le Yard" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open conversation" }));
  await screen.findByText("Human handling · automated replies paused");
  fireEvent.change(screen.getByLabelText(`Reply to ${phone} from Le Yard`), {
    target: { value: "A human can help." },
  });
  vi.mocked(fetch).mockImplementation(async (_url, init) =>
    init?.method === "POST"
      ? Response.json({ status: "queued" }, { status: 201 })
      : Response.json(model),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Send SMS from Le Yard" }),
  );
  await screen.findByText(/Message queued/);
  const call = vi
    .mocked(fetch)
    .mock.calls.find(
      ([url, init]) => url === "/api/phone" && init?.method === "POST",
    );
  expect(JSON.parse(call![1]!.body as string)).toMatchObject({
    action: "sms",
    to: phone,
    body: "A human can help.",
    attachments: [],
  });
});
it("shows an outage rather than claiming there are no messages", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ error: "offline" }, { status: 503 }),
  );
  render(<CommunicationGroups group="clients" />);
  await screen.findByRole("alert");
  expect(screen.queryByText("No messages saved in this view yet.")).toBeNull();
});
it("keeps internal ticket notes separate from SMS and preserves resolved status", async () => {
  const item = {
    id: "12345678-1234-4234-8234-123456789abc",
    kind: "ticket",
    title: "Late arrival",
    body: "Guest wants help",
    phone,
    source_sid: null,
    created_at: incoming.sent_at,
    status: "open",
  };
  vi.mocked(fetch).mockImplementation(async (url, init) =>
    String(url).includes("caseId=")
      ? Response.json({ item, notes: [], source: null })
      : init?.method === "POST"
        ? Response.json({ ok: true })
        : Response.json({ ...model, cases: [item] }),
  );
  render(<CommunicationGroups group="tickets" />);
  fireEvent.click(await screen.findByRole("button", { name: /Late arrival/ }));
  const field = await screen.findByLabelText("Internal ticket note");
  fireEvent.change(field, { target: { value: "I will handle this." } });
  fireEvent.click(screen.getByRole("button", { name: "Post internal note" }));
  await waitFor(() =>
    expect(
      vi.mocked(fetch).mock.calls.some(([, i]) => i?.method === "POST"),
    ).toBe(true),
  );
  const writes = vi
    .mocked(fetch)
    .mock.calls.filter(([, i]) => i?.method === "POST");
  expect(writes[0][0]).toBe("/api/communications/groups");
  expect(JSON.parse(writes[0][1]!.body as string)).toMatchObject({
    action: "note",
    caseId: item.id,
    body: "I will handle this.",
  });
  expect(writes.some(([url]) => url === "/api/phone")).toBe(false);
});
it("keeps older history when polling refreshes recent messages", async () => {
  const older = {
    ...incoming,
    sid: "SM" + "b".repeat(32),
    body: "Older message",
    sent_at: "2026-09-07T12:00:00.000Z",
  };
  vi.mocked(fetch).mockImplementation(async (url) =>
    String(url).includes("before=")
      ? Response.json({ ...model, messages: [older], more: false })
      : Response.json({ ...model, more: true }),
  );
  render(<CommunicationGroups group="clients" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Load older messages" }),
  );
  await screen.findByText("Older message");
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.getByText("Older message")).toBeTruthy());
});
it("does not silently display the previous contact history after selecting another", async () => {
  render(<CommunicationGroups group="clients" />);
  await screen.findByRole("button", { name: "Open conversation" });
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ error: "offline" }, { status: 503 }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Open conversation" }));
  await screen.findByRole("alert");
  expect(screen.queryByText(incoming.body)).toBeNull();
});
