import { createECDH, createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { churchSquareStockPushPublicKey, processChurchSquareStockPush } from "@/lib/integrations/church-square-stock-push.server";
import { encryptPushSubscription, type BrowserPushSubscription } from "@/lib/notifications/push-subscription";

const mocks = vi.hoisted(() => ({ appSurface: "operations", admin: vi.fn(), rpc: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/app-surface", () => ({ get appSurface() { return mocks.appSurface; } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("web-push", () => ({ default: { sendNotification: mocks.send } }));

const id = "11111111-1111-4111-8111-111111111111";
const claimToken = "22222222-2222-4222-8222-222222222222";
const episodeId = "33333333-3333-4333-8333-333333333333";
const exampleEndpoint = "https://fcm.googleapis.com/fcm/send/synthetic-token";
const eligible = "service_claim_church_square_stock_push";
const complete = "service_complete_church_square_stock_push";

function keyPair() {
  const key = createECDH("prime256v1");
  const publicKey = key.generateKeys().toString("base64url");
  const scalar = key.getPrivateKey();
  const privateKey = Buffer.alloc(32);
  scalar.copy(privateKey, privateKey.length - scalar.length);
  return { publicKey, privateKey: privateKey.toString("base64url") };
}

function encryptedClaim(overrides: Partial<BrowserPushSubscription> = {}) {
  const subscription: BrowserPushSubscription = {
    endpoint: exampleEndpoint, expirationTime: null,
    keys: { p256dh: keyPair().publicKey, auth: randomBytes(16).toString("base64url") },
    ...overrides,
  };
  const encrypted = encryptPushSubscription(subscription, process.env.LE_YARD_CHURCH_SQUARE_STOCK_PUSH_ENCRYPTION_KEY);
  return { id, claimToken, episodeId, encryptedSubscription: `\\x${encrypted.toString("hex")}` };
}

function claimOnce(claim: ReturnType<typeof encryptedClaim>) {
  mocks.rpc.mockReturnValueOnce({ abortSignal: async () => ({ data: claim, error: null }) });
}

function expectOutcome(status: string) {
  expect(mocks.rpc).toHaveBeenNthCalledWith(1, eligible, { p_worker_id: expect.any(String) });
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, complete, { p_id: id, p_claim_token: claimToken, p_status: status });
  expect(mocks.rpc).toHaveBeenNthCalledWith(3, eligible, { p_worker_id: mocks.rpc.mock.calls[0][1].p_worker_id });
  expect(mocks.rpc).toHaveBeenCalledTimes(3);
}

beforeEach(() => {
  mocks.appSurface = "operations";
  const { publicKey, privateKey } = keyPair();
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("LE_YARD_CHURCH_SQUARE_STOCK_PUSH_ENABLED", "true");
  vi.stubEnv("LE_YARD_CHURCH_SQUARE_STOCK_VAPID_PUBLIC_KEY", publicKey);
  vi.stubEnv("LE_YARD_CHURCH_SQUARE_STOCK_VAPID_PRIVATE_KEY", privateKey);
  vi.stubEnv("LE_YARD_CHURCH_SQUARE_STOCK_VAPID_SUBJECT", "https://operations.leyardny.com");
  vi.stubEnv("LE_YARD_CHURCH_SQUARE_STOCK_PUSH_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockImplementation((name: string) => ({ abortSignal: async () => ({ data: name === complete ? true : null, error: null }) }));
  mocks.send.mockResolvedValue({ statusCode: 201 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

it("posts only generic notification text and a same-origin inventory path with a short lifetime", async () => {
  claimOnce(encryptedClaim());
  await processChurchSquareStockPush();

  expectOutcome("sent");
  expect(mocks.send).toHaveBeenCalledTimes(1);
  const [, data, options] = mocks.send.mock.calls[0];
  const topic = createHash("sha256").update(episodeId).digest("base64url").slice(0, 32);
  expect(JSON.parse(data)).toEqual({
    title: "Church Street inventory", body: "Low stock needs attention. Open Operations to review the current count.",
    url: "/inventory", tag: `church-stock-${topic}`,
  });
  expect(options).toMatchObject({ TTL: 120, urgency: "high", timeout: 4_000, topic });
  expect(console.warn).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
});

it.each([
  [{ statusCode: 404 }, "gone"], [{ statusCode: 410 }, "gone"], [{ statusCode: 503 }, "failed"],
  [new Error("Synthetic network timeout"), "uncertain"],
] as const)("records a sanitized provider outcome of %s", async (failure, outcome) => {
  claimOnce(encryptedClaim());
  mocks.send.mockRejectedValueOnce(failure);
  await processChurchSquareStockPush();

  expectOutcome(outcome);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  if (outcome !== "gone") expect(console.warn).toHaveBeenCalledExactlyOnceWith("Church Street stock push was not confirmed.", outcome);
  else expect(console.warn).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
});

it("rejects a disallowed destination after decrypting and never calls the provider", async () => {
  claimOnce(encryptedClaim({ endpoint: "https://fcm.googleapis.com.example.invalid/fcm/send/synthetic-token" }));
  await processChurchSquareStockPush();

  expectOutcome("failed");
  expect(mocks.send).not.toHaveBeenCalled();
  expect(console.warn).toHaveBeenCalledExactlyOnceWith("Church Street stock push was not confirmed.", "failed");
});

it("retires an expired subscription without contacting the provider", async () => {
  claimOnce(encryptedClaim({ expirationTime: 1 }));
  await processChurchSquareStockPush();

  expectOutcome("gone");
  expect(mocks.send).not.toHaveBeenCalled();
});

it.each(["switch", "surface", "preview", "configuration"] as const)("keeps all delivery inactive when %s is invalid", async (condition) => {
  if (condition === "switch") vi.stubEnv("LE_YARD_CHURCH_SQUARE_STOCK_PUSH_ENABLED", "TRUE");
  if (condition === "surface") mocks.appSurface = "host";
  if (condition === "preview") vi.stubEnv("VERCEL_ENV", "preview");
  if (condition === "configuration") vi.stubEnv("LE_YARD_CHURCH_SQUARE_STOCK_VAPID_PUBLIC_KEY", keyPair().publicKey);
  expect(churchSquareStockPushPublicKey()).toBeNull();
  await processChurchSquareStockPush();

  expect(mocks.admin).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
