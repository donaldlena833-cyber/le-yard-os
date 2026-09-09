import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { VoiceReceptionSessionDO } from "../../workers/voice-reception/src/worker.mjs";

const NativeResponse = Response;
const sockets: TestSocket[] = [];
class TestSocket extends EventTarget {
  readyState = 0;
  binaryType = "blob";
  accept() { this.readyState = 1; }
  send() { if (this.readyState !== 1) throw new Error("closed"); }
  close() {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}
class TestPair {
  0: TestSocket;
  1: TestSocket;
  constructor() {
    this[0] = new TestSocket();
    this[1] = new TestSocket();
    sockets.push(this[0], this[1]);
  }
}
class UpgradeResponse extends NativeResponse {
  webSocket?: TestSocket;
  constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: TestSocket }) {
    super(body, init?.status === 101 ? { ...init, status: 200 } : init);
    if (init?.status === 101) Object.defineProperty(this, "status", { value: 101 });
    this.webSocket = init?.webSocket;
  }
}
const fetcher = vi.fn();
function upgrade(path = "/stream") {
  return new Request(`https://le-yard-reception.donaldlena833.workers.dev${path}`, {
    headers: { Upgrade: "websocket", "X-Twilio-Signature": "synthetic-provider-signature" },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocketPair", TestPair);
  vi.stubGlobal("Response", UpgradeResponse);
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  fetcher.mockRejectedValue(new Error("No provider requests in wrapper tests"));
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
  expect(fetcher).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("per-call Durable Object dispatch", () => {
  it("uses a fresh object for each upgrade and preserves the original signed request", async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response("delegated"));
    const namespace = {
      newUniqueId: vi.fn().mockReturnValueOnce("call-one").mockReturnValueOnce("call-two"),
      get: vi.fn().mockReturnValue({ fetch: stubFetch }),
    };
    const first = upgrade();
    const second = upgrade();
    expect(await (await worker.fetch(first, { VOICE_SESSIONS: namespace })).text()).toBe("delegated");
    await worker.fetch(second, { VOICE_SESSIONS: namespace });
    expect(namespace.newUniqueId).toHaveBeenCalledTimes(2);
    expect(namespace.get.mock.calls).toEqual([["call-one"], ["call-two"]]);
    expect(stubFetch.mock.calls).toEqual([[first], [second]]);
    expect(first.headers.get("x-twilio-signature")).toBe("synthetic-provider-signature");
    expect(sockets).toHaveLength(0);
  });

  it("rejects invalid requests before allocating a Durable Object", async () => {
    const namespace = { newUniqueId: vi.fn(), get: vi.fn() };
    expect((await worker.fetch(upgrade("/stream?token=unsafe"), { VOICE_SESSIONS: namespace })).status).toBe(400);
    expect((await worker.fetch(upgrade("/other"), { VOICE_SESSIONS: namespace })).status).toBe(404);
    expect((await worker.fetch(new Request("https://voice.example/stream"), { VOICE_SESSIONS: namespace })).status).toBe(426);
    expect(namespace.newUniqueId).not.toHaveBeenCalled();
  });

  it("fails closed when the namespace is missing or dispatch fails", async () => {
    expect((await worker.fetch(upgrade(), {})).status).toBe(503);
    const namespace = {
      newUniqueId: vi.fn().mockReturnValue("call"),
      get: vi.fn().mockReturnValue({ fetch: vi.fn().mockRejectedValue(new Error("private binding diagnostic")) }),
    };
    const response = await worker.fetch(upgrade(), { VOICE_SESSIONS: namespace });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private binding diagnostic");
    expect(sockets).toHaveLength(0);
  });
});

describe("voice Durable Object socket ownership", () => {
  it("accepts one standard socket per object without using storage or hibernation", async () => {
    const ctx = new Proxy({}, { get() { throw new Error("No storage or hibernation access is needed"); } });
    const object = new VoiceReceptionSessionDO(ctx, { VOICE_APP_ORIGIN: "https://phone.leyardny.com" });
    const response = await object.fetch(upgrade());
    expect(response.status).toBe(101);
    expect((response as UpgradeResponse).webSocket).toBe(sockets[0]);
    expect(sockets[1].readyState).toBe(1);
    expect((await object.fetch(upgrade())).status).toBe(409);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5001);
    expect(sockets[1].readyState).toBe(3);
  });

  it("validates requests inside the object before reserving its session", async () => {
    const object = new VoiceReceptionSessionDO({}, {});
    expect((await object.fetch(upgrade("/stream?token=unsafe"))).status).toBe(400);
    expect((await object.fetch(new Request("https://voice.example/stream"))).status).toBe(426);
    expect((await object.fetch(upgrade())).status).toBe(101);
    expect(sockets).toHaveLength(2);
  });

  it("closes the server socket on initialization failure", async () => {
    const object = new VoiceReceptionSessionDO({}, { VOICE_APP_ORIGIN: "http://unsafe.example" });
    const response = await object.fetch(upgrade());
    expect(response.status).toBe(503);
    expect(sockets[1].readyState).toBe(3);
  });

  it("provisions the Free-compatible SQLite class without an unsupported CPU override", () => {
    const config = JSON.parse(readFileSync("workers/voice-reception/wrangler.jsonc", "utf8"));
    expect(config.durable_objects.bindings).toContainEqual({ name: "VOICE_SESSIONS", class_name: "VoiceReceptionSessionDO" });
    expect(config.migrations).toContainEqual({ tag: "voice-session-v1", new_sqlite_classes: ["VoiceReceptionSessionDO"] });
    expect(config.limits?.cpu_ms).toBeUndefined();
  });
});
