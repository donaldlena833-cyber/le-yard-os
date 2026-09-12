import { createClient } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

const mocks = vi.hoisted(() => ({ tenant: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/communications.server", () => ({ resolveLeYardTenant: mocks.tenant }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from }),
}));

import { resolveCommunicationMessageLink } from "@/lib/communication-message-link.server";

const sid = `SM${"a".repeat(32)}`;
const workspace = {
  mode: "live",
  role: "owner",
  organization: { id: "org" },
  activeLocation: { id: "loc" },
} as WorkspaceContextValue;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenant.mockResolvedValue({ organizationId: "org", locationId: "loc" });
});

it.each(["employee", "manager"] as const)("denies a %s before reading a source message", async (role) => {
  expect(await resolveCommunicationMessageLink({ ...workspace, role }, sid)).toMatchObject({ status: "unavailable" });
  expect(mocks.tenant).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
});

it("denies a demo session before reading live messages", async () => {
  expect(await resolveCommunicationMessageLink({ ...workspace, mode: "demo" }, sid)).toMatchObject({ status: "unavailable" });
  expect(mocks.from).not.toHaveBeenCalled();
});

it.each(["", "SMinvalid", `${sid},or(sid.neq.null)`, [sid, sid]])("rejects malformed or repeated message values without a database read", async (value) => {
  expect(await resolveCommunicationMessageLink(workspace, value)).toMatchObject({ status: "unavailable" });
  expect(mocks.from).not.toHaveBeenCalled();
});

it.each([
  { organizationId: "other-org", locationId: "loc" },
  { organizationId: "org", locationId: "other-loc" },
])("denies access outside the configured tenant and location", async (tenant) => {
  mocks.tenant.mockResolvedValue(tenant);
  expect(await resolveCommunicationMessageLink(workspace, sid)).toMatchObject({ status: "unavailable" });
  expect(mocks.from).not.toHaveBeenCalled();
});

it.each([
  { role: "owner", audience: "client", group: "clients" },
  { role: "admin", audience: "team", group: "team" },
] as const)("opens the saved $audience conversation for an authorized $role", async ({ role, audience, group }) => {
  const urls: URL[] = [];
  const client = createClient("https://database.example.test", "fixture-key", {
    global: { fetch: async (input) => {
      urls.push(new URL(String(input)));
      return Response.json({ phone: "+12125550123", audience });
    } },
    auth: { persistSession: false },
  });
  mocks.from.mockImplementation((table) => client.from(table));

  expect(await resolveCommunicationMessageLink({ ...workspace, role }, sid)).toEqual({
    status: "ready", phone: "+12125550123", group,
  });
  expect(urls).toHaveLength(1);
  expect(urls[0].pathname).toBe("/rest/v1/communication_messages");
  expect(urls[0].searchParams.get("organization_id")).toBe("eq.org");
  expect(urls[0].searchParams.get("location_id")).toBe("eq.loc");
  expect(urls[0].searchParams.get("sid")).toBe(`eq.${sid}`);
  expect(urls[0].searchParams.get("select")).toBe("phone,audience");
});

it.each([
  { data: null, error: null },
  { data: null, error: new Error("Database unavailable") },
  { data: { phone: "invalid", audience: "client" }, error: null },
  { data: { phone: "+12125550123", audience: "unknown" }, error: null },
])("returns a clear unavailable state without a fallback recipient", async (result) => {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(result) };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
  const target = await resolveCommunicationMessageLink(workspace, sid);
  expect(target).toMatchObject({ status: "unavailable", message: expect.stringContaining("current workspace") });
  expect(target).not.toHaveProperty("phone");
});
