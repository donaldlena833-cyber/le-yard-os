import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  previous: null as Record<string, unknown> | null,
  employee: null as { id: string; display_name: string } | null,
  write: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/communications.server", () => ({
  resolveLeYardTenant: async () => ({
    organizationId: "org",
    locationId: "loc",
  }),
}));
vi.mock("@/lib/twilio.server", () => ({
  twilioPhoneNumber: () => "+13328779035",
  twilioForwardNumbers: () => ({
    donald: "+12125550101",
    maris: "+12125550102",
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: m.rpc,
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: m.previous, error: null }),
        upsert: m.write,
      };
      return q;
    },
  }),
}));
import { saveCommunicationMessage } from "@/lib/communication-groups.server";
const input = {
  sid: "SM" + "a".repeat(32),
  from: "+12125550123",
  to: "+13328779035",
  body: " Exact\nmessage ",
  status: "received",
  at: "2026-09-08T12:00:00Z",
  mediaCount: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  m.previous = null;
  m.employee = null;
  m.rpc.mockImplementation(async () => ({
    data: m.employee ? [m.employee] : [],
    error: null,
  }));
  m.write.mockResolvedValue({ error: null });
});
it("archives exact inbound content with the tenant and stable provider key", async () => {
  expect(await saveCommunicationMessage(input)).toEqual({ internal: false });
  expect(m.write).toHaveBeenCalledWith(
    expect.objectContaining({
      organization_id: "org",
      location_id: "loc",
      sid: input.sid,
      body: input.body,
      audience: "client",
      media_count: 1,
    }),
    { onConflict: "organization_id,sid" },
  );
});
it("routes a recorded employee to Team requests and preserves their display name", async () => {
  m.employee = { id: "employee", display_name: "Employee" };
  expect(await saveCommunicationMessage(input)).toEqual({ internal: true });
  expect(m.rpc).toHaveBeenCalledWith("communication_employee_for_phone", {
    p_organization_id: "org",
    p_phone: input.from,
  });
  expect(m.write.mock.calls[0][0]).toMatchObject({
    audience: "team",
    contact_name: "Employee",
    sender_kind: "staff",
  });
});
it("never guesses an outgoing author when the provider cannot establish it", async () => {
  await saveCommunicationMessage({ ...input, from: input.to, to: input.from });
  expect(m.write.mock.calls[0][0]).toMatchObject({
    sender_kind: "unknown",
    direction: "outbound",
  });
});
it("retains the original text and known human author during reconciliation", async () => {
  m.previous = {
    body: input.body,
    sender_kind: "staff",
    actor_id: "owner",
    sent_at: input.at,
    audience: "team",
    contact_name: "Employee",
  };
  await saveCommunicationMessage({
    ...input,
    from: input.to,
    to: input.from,
    body: "",
    senderKind: "unknown",
  });
  expect(m.write.mock.calls[0][0]).toMatchObject({
    body: input.body,
    sender_kind: "staff",
    actor_id: "owner",
    audience: "team",
    contact_name: "Employee",
  });
});
it("rejects messages unrelated to the Le Yard number before writing", async () => {
  await expect(
    saveCommunicationMessage({ ...input, to: "+12125550199" }),
  ).rejects.toThrow("outside Le Yard scope");
  expect(m.write).not.toHaveBeenCalled();
});
it("fails receipt processing when the archive cannot persist", async () => {
  m.write.mockResolvedValue({ error: { message: "offline" } });
  await expect(saveCommunicationMessage(input)).rejects.toThrow(
    "could not be saved",
  );
});
