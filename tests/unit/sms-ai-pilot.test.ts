import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  consent: vi.fn(),
  notify: vi.fn(),
  mode: vi.fn(),
  setMode: vi.fn(),
  handoff: vi.fn(),
  availability: vi.fn(),
  classify: vi.fn(),
  eligible: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/communications.server", () => ({
  hasServiceSmsConsent: mocks.consent,
  notifyOwnersOfCommunication: mocks.notify,
  resolveLeYardTenant: async () => ({
    organizationId: "org",
    locationId: "loc",
  }),
}));
vi.mock("@/lib/communication-groups.server", () => ({
  communicationThreadMode: mocks.mode,
  setCommunicationThreadMode: mocks.setMode,
}));
vi.mock("@/lib/communication-handoff.server", () => ({
  performCommunicationHandoff: mocks.handoff,
}));
vi.mock("@/lib/communications-reservations.server", () => ({
  communicationsAvailability: mocks.availability,
}));
vi.mock("@/lib/gemini-sms.server", () => ({ classifySms: mocks.classify }));
vi.mock("@/lib/sms-ai-policy", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  smsPilotContact: mocks.eligible,
}));
vi.mock("@/lib/twilio.server", () => ({
  sendTwilioMessage: mocks.send,
  twilioSmsEnabled: () => true,
  twilioPhoneNumber: () => "+15005550006",
  twilioAccountSid: vi.fn(),
  twilioAuthToken: vi.fn(),
  twilioRestClient: vi.fn(),
}));
import { processSmsPilotQueue } from "@/lib/sms-ai-pilot.server";

let updates: Record<string, unknown>[];
let claimStatus: string;
beforeEach(() => {
  vi.clearAllMocks();
  updates = [];
  claimStatus = "claimed";
  mocks.eligible.mockReturnValue(true);
  mocks.consent.mockResolvedValue(true);
  mocks.mode.mockResolvedValue("automation");
  mocks.notify.mockResolvedValue(undefined);
  mocks.setMode.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue({ sid: "SMreply" });
  mocks.handoff.mockImplementation(async () =>
    Response.json({ noticeSid: "SMnotice" }),
  );
  mocks.classify.mockResolvedValue({
    decision: {
      intent: "contact",
      date: null,
      partySize: null,
      time: null,
      summary: "Contact question",
      photoDescription: null,
    },
    inputTokens: 100,
    outputTokens: 50,
    cost: 100,
    latencyMs: 500,
  });
  let polls = 0;
  mocks.admin.mockReturnValue({
    rpc: async () => ({ data: { status: claimStatus }, error: null }),
    from: (table: string) => {
      let update = false;
      const query: Record<string, unknown> = {};
      for (const name of ["select", "eq", "gte", "lte", "order", "or"])
        query[name] = () => query;
      query.update = (value: Record<string, unknown>) => {
        updates.push(value);
        update = true;
        return query;
      };
      query.limit = () =>
        table === "communication_messages"
          ? Promise.resolve({ data: [], error: null })
          : query;
      query.single = async () => ({
        data: {
          sid: "SMincoming",
          from_number: "+15005550001",
          location_id: "loc",
          audience: "team",
          body: "Hello",
          media_count: 0,
          sent_at: "2026-09-08T11:00:00Z",
        },
        error: null,
      });
      query.maybeSingle = async () => ({
        data: polls++ === 0 ? { source_sid: "SMincoming" } : null,
        error: null,
      });
      query.then = (resolve: (value: unknown) => void) =>
        resolve(update ? { error: null } : { data: [], error: null });
      return query;
    },
  });
});

it("records classified cost and a single guarded reply", async () => {
  await processSmsPilotQueue();
  expect(mocks.classify).toHaveBeenCalledOnce();
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(updates.at(-1)).toMatchObject({
    status: "completed",
    reply_sid: "SMreply",
    reserved_micro_usd: 100,
  });
});
it.each(["human", "optout"])(
  "stops when %s changes while the model is running",
  async (change) => {
    mocks.classify.mockImplementationOnce(async () => {
      if (change === "human") mocks.mode.mockResolvedValue("human");
      else mocks.consent.mockResolvedValue(false);
      return { decision: { intent: "contact" }, cost: 100, latencyMs: 500 };
    });
    await processSmsPilotQueue();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.handoff).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({
      status: "held",
      error_code: "send_guard_changed",
    });
  },
);
it("hands a provider failure to a human without retrying the model", async () => {
  mocks.classify.mockRejectedValue(new Error("provider timeout"));
  await processSmsPilotQueue();
  expect(mocks.classify).toHaveBeenCalledOnce();
  expect(mocks.handoff).toHaveBeenCalledOnce();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(updates.at(-1)).toMatchObject({
    status: "failed",
    reply_sid: "SMnotice",
  });
  expect(updates.at(-1)).not.toHaveProperty("reserved_micro_usd");
});
it("does not send a failure notice after human takeover", async () => {
  mocks.classify.mockImplementationOnce(async () => {
    mocks.mode.mockResolvedValue("human");
    throw new Error("timeout");
  });
  await processSmsPilotQueue();
  expect(mocks.handoff).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
it("holds an uncertain send without retrying or sending a second notice", async () => {
  mocks.send.mockRejectedValue(new Error("ambiguous timeout"));
  await processSmsPilotQueue();
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(mocks.handoff).not.toHaveBeenCalled();
  expect(mocks.setMode).toHaveBeenCalledWith(
    "+15005550001",
    "human",
    expect.any(String),
  );
  expect(updates.at(-1)).toMatchObject({
    status: "failed",
    error_code: "send_unconfirmed",
  });
});
it("hands off unavailable inventory instead of claiming no tables exist", async () => {
  mocks.classify.mockResolvedValue({
    decision: {
      intent: "reservation",
      date: "2026-12-01",
      partySize: 2,
      summary: "Table for two",
    },
    cost: 100,
  });
  mocks.availability.mockRejectedValue(new Error("inventory unavailable"));
  await processSmsPilotQueue();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.handoff).toHaveBeenCalledWith(
    expect.objectContaining({
      reason: expect.stringContaining("verification"),
    }),
    expect.any(Object),
  );
});
it.each(["busy", "processing", "completed"])(
  "does not repeat a %s job",
  async (status) => {
    claimStatus = status;
    await processSmsPilotQueue();
    expect(mocks.classify).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  },
);
it("does not call the model for an ineligible contact", async () => {
  mocks.eligible.mockReturnValue(false);
  await processSmsPilotQueue();
  expect(mocks.classify).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(updates.at(-1)).toMatchObject({
    status: "held",
    error_code: "pilot_disabled",
  });
});
it("hands off on exhausted budget before calling the model", async () => {
  claimStatus = "budget";
  await processSmsPilotQueue();
  expect(mocks.classify).not.toHaveBeenCalled();
  expect(mocks.handoff).toHaveBeenCalledOnce();
});
