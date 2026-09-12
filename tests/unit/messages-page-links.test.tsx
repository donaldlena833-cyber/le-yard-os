import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), target: vi.fn(), load: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/lib/permissions/route-access.server", () => ({ requireWorkspaceRouteAccess: vi.fn() }));
vi.mock("@/lib/communication-message-link.server", () => ({ resolveCommunicationMessageLink: mocks.target }));
vi.mock("@/data/read-models/messages", () => ({ loadLiveMessages: mocks.load }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/messages/messages-hub", () => ({ MessagesHub: () => null }));
vi.mock("@/components/messages/live-messages-workspace", () => ({ LiveMessagesWorkspace: () => null }));
vi.mock("@/components/messages/messages-workspace", () => ({ MessagesWorkspace: () => null }));

import MessagesPage from "@/app/(workspace)/messages/page";

const sid = `SM${"a".repeat(32)}`;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ status: "ready", context: { mode: "live", role: "owner", organization: { id: "org" }, activeLocation: { id: "loc" } } });
  mocks.target.mockResolvedValue({ status: "ready", group: "team", phone: "+12125550124" });
  mocks.load.mockResolvedValue({ ok: true, data: {} });
  mocks.redirect.mockImplementation(() => { throw new Error("redirect"); });
});

it("resolves the source message in preference to a conflicting guest filter", async () => {
  const result = await MessagesPage({ searchParams: Promise.resolve({ message: sid, group: "clients", phone: "+12125550123" }) });
  expect(result?.props).toMatchObject({ initialGroup: "team", initialPhone: "+12125550124" });
});

it("does not fall back to a guest filter if source resolution fails", async () => {
  mocks.target.mockResolvedValue({ status: "unavailable", message: "Conversation unavailable." });
  const result = await MessagesPage({ searchParams: Promise.resolve({ message: sid, group: "clients", phone: "+12125550123" }) });
  expect(result?.props).toMatchObject({ initialPhone: undefined, messageLinkError: "Conversation unavailable." });
});

it("preserves existing group and phone links without resolving a source message", async () => {
  const result = await MessagesPage({ searchParams: Promise.resolve({ group: "team", phone: "+12125550123" }) });
  expect(result?.props).toMatchObject({ initialGroup: "team", initialPhone: "+12125550123" });
  expect(mocks.target).not.toHaveBeenCalled();
});

it("changes the page key when opening another source message", async () => {
  const first = await MessagesPage({ searchParams: Promise.resolve({ message: sid }) });
  const second = await MessagesPage({ searchParams: Promise.resolve({ message: `SM${"b".repeat(32)}` }) });
  expect(first?.key).not.toBe(second?.key);
});

it("preserves the source link in the sign-in return destination", async () => {
  mocks.session.mockResolvedValue({ status: "unauthenticated" });
  await expect(MessagesPage({ searchParams: Promise.resolve({ message: sid, group: "team" }) })).rejects.toThrow("redirect");
  const redirect = new URL(mocks.redirect.mock.calls[0][0], "https://operations.leyardny.com");
  const destination = new URL(redirect.searchParams.get("next")!, redirect.origin);
  expect(redirect.pathname).toBe("/sign-in");
  expect(destination.pathname).toBe("/messages");
  expect(destination.searchParams.get("message")).toBe(sid);
  expect(destination.searchParams.get("group")).toBe("team");
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.target).not.toHaveBeenCalled();
});
