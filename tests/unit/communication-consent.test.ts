import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  event: null as null | string,
  body: "Please help with my booking" as string | null,
  error: false,
  calls: [] as string[],
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      state.calls.push(table);
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        contains: () => q,
        order: () => q,
        limit: () => q,
        gte: () => q,
        maybeSingle: async () =>
          table === "locations"
            ? {
                data: {
                  id: "loc",
                  organization_id: "org",
                  timezone: "America/New_York",
                },
                error: null,
              }
            : table === "integration_events"
              ? {
                  data: state.event ? { event_type: state.event } : null,
                  error: null,
                }
              : {
                  data: state.body === null ? null : { body: state.body },
                  error: state.error ? { message: "offline" } : null,
                },
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/twilio.server", () => ({ normalizeE164: (n: string) => n }));
import { hasServiceSmsConsent } from "@/lib/communications.server";
beforeEach(() => {
  state.event = null;
  state.body = "Please help with my booking";
  state.error = false;
  state.calls = [];
});
it("allows a reply to a recent user-initiated exchange without granting recurring consent", async () => {
  expect(await hasServiceSmsConsent("+12125550123")).toBe(true);
  expect(state.calls).toContain("communication_messages");
});
it("never uses inbound history to override a recorded STOP", async () => {
  state.event = "sms.consent.revoked";
  expect(await hasServiceSmsConsent("+12125550123")).toBe(false);
  expect(state.calls).not.toContain("communication_messages");
});
it.each(["STOP", "STOPALL", "HELP"])(
  "does not treat %s as a service request",
  async (body) => {
    state.body = body;
    expect(await hasServiceSmsConsent("+12125550123")).toBe(false);
  },
);
it("requires separate permission if there is no recent inbound exchange", async () => {
  state.body = null;
  expect(await hasServiceSmsConsent("+12125550123")).toBe(false);
});
it("fails closed when reply permission cannot be read", async () => {
  state.error = true;
  await expect(hasServiceSmsConsent("+12125550123")).rejects.toThrow(
    "Reply permission",
  );
});
