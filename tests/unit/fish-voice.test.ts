import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  fetch: vi.fn(),
  bucket: vi.fn(),
  info: vi.fn(),
  upload: vi.fn(),
  sign: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: mocks.bucket } }),
}));

function pcm(values: number[]) {
  const bytes = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => bytes.writeInt16LE(value, index * 2));
  return bytes;
}

function wav(values: number[], sampleRate = 16_000, channels = 1) {
  const body = pcm(values);
  const bytes = Buffer.alloc(44 + body.length);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(body.length, 40);
  body.copy(bytes, 44);
  return bytes;
}

function fishAudio(bytes = pcm(Array(4_000).fill(5_000)), contentType = "application/octet-stream") {
  return new Response(new Uint8Array(bytes), { headers: { "content-type": contentType } });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("FISH_API_KEY", "test-only-fish-key");
  vi.stubEnv("FISH_VOICE_MODEL", "");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.readFile.mockResolvedValue(wav(Array(16_000).fill(1_000)));
  mocks.fetch.mockImplementation(() => Promise.resolve(fishAudio()));
  mocks.bucket.mockReturnValue({ info: mocks.info, upload: mocks.upload, createSignedUrl: mocks.sign });
  mocks.info.mockResolvedValue({ data: null, error: { statusCode: "404", code: "not_found" } });
  mocks.upload.mockResolvedValue({ data: { path: "hashed.wav" }, error: null });
  mocks.sign.mockResolvedValue({ data: { signedUrl: "https://storage.example.test/private-audio?token=test" }, error: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Fish receptionist synthesis", () => {
  it("requests the selected voice as low-latency 16 kHz PCM and emits a valid mono WAV", async () => {
    const { synthesizeReceptionSpeech } = await import("@/lib/fish-voice.server");
    const result = await synthesizeReceptionSpeech("  Thanks for calling\nLe Yard.  ");
    const [url, request] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://api.fish.audio/v1/tts");
    expect(request.headers).toEqual(expect.objectContaining({ model: "s2.1-pro-free", Authorization: "Bearer test-only-fish-key" }));
    expect(JSON.parse(request.body)).toEqual(expect.objectContaining({
      text: "Thanks for calling Le Yard.",
      reference_id: "9a9cf47702da476aa4629e2506d4a857",
      sample_rate: 16_000,
      format: "pcm",
      latency: "low",
    }));
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(result.toString("ascii", 0, 4)).toBe("RIFF");
    expect(result.toString("ascii", 8, 12)).toBe("WAVE");
    expect(result.readUInt32LE(24)).toBe(16_000);
    expect(result.readUInt16LE(22)).toBe(1);
    expect(result.readUInt16LE(34)).toBe(16);
    expect(result.readUInt32LE(40)).toBe(8_000);
    expect(result.readInt16LE(44)).toBe(0);
    expect(result.readInt16LE(result.length - 2)).toBe(0);
  });

  it("ducks the quiet room sound beneath speech and keeps it audible in a pause", async () => {
    mocks.fetch.mockResolvedValue(fishAudio(pcm([...Array(8_000).fill(6_000), ...Array(8_000).fill(0)])));
    const { synthesizeReceptionSpeech } = await import("@/lib/fish-voice.server");
    const audio = await synthesizeReceptionSpeech("Let me check that. One moment.");
    const underSpeech = audio.readInt16LE(44 + 4_000 * 2) - 6_000 * 0.94;
    const duringPause = audio.readInt16LE(44 + 12_000 * 2);
    expect(underSpeech).toBeGreaterThan(90);
    expect(underSpeech).toBeLessThan(140);
    expect(duringPause).toBe(328);
  });

  it("accepts provider WAV and stereo ambience while converting output to mono 16 kHz", async () => {
    mocks.readFile.mockResolvedValue(wav(Array(8_000).fill(800), 8_000, 2));
    mocks.fetch.mockResolvedValue(fishAudio(wav(Array(2_000).fill(4_000), 8_000), "audio/wav"));
    const { synthesizeReceptionSpeech } = await import("@/lib/fish-voice.server");
    const audio = await synthesizeReceptionSpeech("Welcome.");
    expect(audio.readUInt32LE(24)).toBe(16_000);
    expect(audio.readUInt32LE(40)).toBe(8_000);
  });

  it("caps input to 450 characters and permits an explicit configured model", async () => {
    vi.stubEnv("FISH_VOICE_MODEL", "s2.1-pro");
    const { synthesizeReceptionSpeech } = await import("@/lib/fish-voice.server");
    await synthesizeReceptionSpeech("A".repeat(700));
    const request = mocks.fetch.mock.calls[0][1];
    expect(JSON.parse(request.body).text).toHaveLength(450);
    expect(request.headers.model).toBe("s2.1-pro");
  });

  it("rejects empty speech or missing credentials before sending a provider request", async () => {
    const { synthesizeReceptionSpeech } = await import("@/lib/fish-voice.server");
    await expect(synthesizeReceptionSpeech("   ")).rejects.toThrow("Voice speech text is empty");
    vi.stubEnv("FISH_API_KEY", "");
    await expect(synthesizeReceptionSpeech("Hello")).rejects.toThrow("Fish voice is not configured");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    () => new Response("provider private diagnostic", { status: 402 }),
    () => new Response('{"secret":"provider detail"}', { headers: { "content-type": "application/json" } }),
    () => fishAudio(Buffer.from([1, 2, 3])),
    () => fishAudio(Buffer.alloc(16_000 * 2 * 90 + 2)),
  ])("returns a safe failure for invalid or unavailable provider audio", async (response) => {
    mocks.fetch.mockResolvedValue(response());
    const { synthesizeReceptionSpeech } = await import("@/lib/fish-voice.server");
    await expect(synthesizeReceptionSpeech("Private guest request")).rejects.toThrow(/^Fish voice synthesis failed$/);
  });

  it("times out provider work in 5.5 seconds even if a transport ignores abort", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockReturnValue(new Promise(() => undefined));
    const { synthesizeReceptionSpeech } = await import("@/lib/fish-voice.server");
    const result = synthesizeReceptionSpeech("Hello");
    const assertion = expect(result).rejects.toThrow("Fish voice synthesis failed");
    await vi.advanceTimersByTimeAsync(5_500);
    await assertion;
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
});

describe("private voice audio cache", () => {
  it("uploads generated audio under a hash and returns a ten-minute signed URL", async () => {
    const { publishReceptionSpeech } = await import("@/lib/fish-voice.server");
    const url = await publishReceptionSpeech("Reservation for a private guest");
    expect(url).toMatch(/^https:/);
    expect(mocks.bucket).toHaveBeenCalledWith("voice-reception");
    const [key, bytes, options] = mocks.upload.mock.calls[0];
    expect(key).toMatch(/^hannah-room-v1\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{64}\.wav$/);
    expect(key).not.toContain("guest");
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(options).toEqual({ contentType: "audio/wav", cacheControl: "3600", upsert: false });
    expect(mocks.sign).toHaveBeenCalledWith(key, 600);
  });

  it("reuses a cached object without another paid synthesis or upload", async () => {
    mocks.info.mockResolvedValue({ data: { size: 1_000 }, error: null });
    const { publishReceptionSpeech } = await import("@/lib/fish-voice.server");
    await publishReceptionSpeech("Hello");
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.sign).toHaveBeenCalledOnce();
  });

  it("separates cache entries by voice model", async () => {
    mocks.info.mockResolvedValue({ data: { size: 1_000 }, error: null });
    const { publishReceptionSpeech } = await import("@/lib/fish-voice.server");
    await publishReceptionSpeech("Hello");
    vi.stubEnv("FISH_VOICE_MODEL", "s2.1-pro");
    await publishReceptionSpeech("Hello");
    expect(mocks.info.mock.calls[0][0]).not.toEqual(mocks.info.mock.calls[1][0]);
  });

  it("accepts a concurrent duplicate upload only after verifying the object exists", async () => {
    mocks.upload.mockResolvedValue({ error: { statusCode: "409" } });
    mocks.info.mockResolvedValueOnce({ data: null, error: { statusCode: "404" } })
      .mockResolvedValueOnce({ data: { size: 1_000 }, error: null });
    const { publishReceptionSpeech } = await import("@/lib/fish-voice.server");
    await expect(publishReceptionSpeech("Welcome")).resolves.toMatch(/^https:/);
    expect(mocks.info).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it("fails closed on storage permission errors without spending on generation", async () => {
    mocks.info.mockResolvedValue({ data: null, error: { statusCode: "403", message: "private diagnostic" } });
    const { publishReceptionSpeech } = await import("@/lib/fish-voice.server");
    await expect(publishReceptionSpeech("Guest name")).rejects.toThrow(/^Reception voice audio is unavailable$/);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects a failed upload without issuing a signed URL", async () => {
    mocks.upload.mockResolvedValue({ error: { statusCode: "500" } });
    const { publishReceptionSpeech } = await import("@/lib/fish-voice.server");
    await expect(publishReceptionSpeech("Hello")).rejects.toThrow("Reception voice audio is unavailable");
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("bounds all cache, generation, upload and signing work to 7.5 seconds", async () => {
    vi.useFakeTimers();
    mocks.info.mockReturnValue(new Promise(() => undefined));
    const { publishReceptionSpeech } = await import("@/lib/fish-voice.server");
    const result = publishReceptionSpeech("Hello");
    const assertion = expect(result).rejects.toThrow("Reception voice audio is unavailable");
    await vi.advanceTimersByTimeAsync(7_500);
    await assertion;
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("fails on signing errors and never exposes provider or storage diagnostics", async () => {
    mocks.info.mockResolvedValue({ data: { size: 1_000 }, error: null });
    mocks.sign.mockResolvedValue({ data: null, error: { message: "secret storage diagnostic" } });
    const { publishReceptionSpeech } = await import("@/lib/fish-voice.server");
    await expect(publishReceptionSpeech("Hello")).rejects.toThrow(/^Reception voice audio is unavailable$/);
  });
});
