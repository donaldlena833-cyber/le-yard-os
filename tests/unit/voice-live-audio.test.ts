import { describe, expect, it } from "vitest";
import { createAudioCodec, mulawToPcm16k, pcm24kToMulaw } from "../../workers/voice-reception/src/audio.mjs";

const base64 = (bytes: Uint8Array | number[]) => Buffer.from(bytes).toString("base64");
const bytes = (encoded: string) => Buffer.from(encoded, "base64");
function pcm(samples: number[]) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));
  return data;
}
function samples(encoded: string) {
  const data = bytes(encoded);
  return Array.from({ length: data.length / 2 }, (_, index) => data.readInt16LE(index * 2));
}
function joinOutputs(outputs: string[]) {
  return Buffer.concat(outputs.map(bytes));
}

describe("Twilio G.711 mu-law to Gemini 16 kHz PCM", () => {
  it("decodes known zero, positive, negative, and full-scale G.711 vectors", () => {
    const encoded = [0xff, 0x7f, 0xfe, 0x7e, 0xce, 0x4e, 0x80, 0x00];
    const decoded = samples(mulawToPcm16k(base64(encoded)));
    expect(decoded.filter((_, index) => index % 2 === 1)).toEqual([0, 0, 8, -8, 988, -988, 32124, -32124]);
    expect(decoded.every((sample) => sample >= -32768 && sample <= 32767)).toBe(true);
  });

  it("interpolates transitions instead of just duplicating every input sample", () => {
    expect(samples(mulawToPcm16k(base64([0xff, 0xce, 0x4e])))).toEqual([0, 0, 494, 988, 0, -988]);
  });

  it("returns exactly 320 little-endian PCM samples for a 20 ms Twilio frame", () => {
    const decoded = bytes(mulawToPcm16k(base64(new Uint8Array(160).fill(0xff))));
    expect(decoded.length).toBe(640);
    expect(decoded.every((value) => value === 0)).toBe(true);
  });

  it("keeps interpolation continuous across irregular media chunk boundaries", () => {
    const input = Uint8Array.from({ length: 377 }, (_, i) => (i * 37) & 255);
    const codec = createAudioCodec();
    const actual = joinOutputs([
      codec.mulawToPcm16k(base64(input.subarray(0, 1))),
      codec.mulawToPcm16k(base64(input.subarray(1, 160))),
      codec.mulawToPcm16k(""),
      codec.mulawToPcm16k(base64(input.subarray(160, 163))),
      codec.mulawToPcm16k(base64(input.subarray(163))),
    ]);
    expect(actual).toEqual(bytes(mulawToPcm16k(base64(input))));
  });
});

describe("Gemini 24 kHz PCM to Twilio G.711 mu-law", () => {
  it.each([
    [0, 0xff], [8, 0xfe], [-8, 0x7e], [988, 0xce], [-988, 0x4e], [32124, 0x80], [-32124, 0x00],
  ])("encodes settled PCM amplitude %i as known G.711 code %i", (amplitude, code) => {
    const output = bytes(pcm24kToMulaw(base64(pcm(Array(240).fill(amplitude)))));
    // Ignore the causal FIR startup; constant signals retain their exact DC level.
    expect(Array.from(output.subarray(30))).toEqual(Array(output.length - 30).fill(code));
  });

  it("produces 160 mu-law bytes for 480 PCM samples, preserving 20 ms duration", () => {
    const output = bytes(pcm24kToMulaw(base64(pcm(Array(480).fill(0)))));
    expect(output.length).toBe(160);
    expect(output.every((value) => value === 0xff)).toBe(true);
  });

  it("round trips small representative quantized amplitudes after filter settling", () => {
    for (const amplitude of [-32124, -988, -8, 0, 8, 988, 32124]) {
      const ulaw = pcm24kToMulaw(base64(pcm(Array(240).fill(amplitude))));
      expect(samples(mulawToPcm16k(ulaw)).at(-1)).toBe(amplitude);
    }
  });

  it("preserves FIR history, decimation phase, and byte-split samples across chunks", () => {
    const input = pcm(Array.from({ length: 1901 }, (_, i) => Math.round(15000 * Math.sin(i * 0.19))));
    const codec = createAudioCodec();
    const sizes = [1, 3, 17, 32, 161, 4, 19, 2, 321];
    let offset = 0;
    let index = 0;
    const output = [];
    while (offset < input.length) {
      const end = Math.min(input.length, offset + sizes[index++ % sizes.length]);
      output.push(codec.pcm24kToMulaw(base64(input.subarray(offset, end))));
      offset = end;
    }
    expect(joinOutputs(output)).toEqual(bytes(pcm24kToMulaw(base64(input))));
  });

  it("retains fewer than three input samples until enough arrive for an output sample", () => {
    const codec = createAudioCodec();
    expect(codec.pcm24kToMulaw(base64(pcm([0, 0])))).toBe("");
    expect(bytes(codec.pcm24kToMulaw(base64(pcm([0]))))).toEqual(Buffer.from([0xff]));
    expect(codec.pcm24kToMulaw(base64([0]))).toBe("");
    expect(codec.pcm24kToMulaw("")).toBe("");
    expect(bytes(codec.pcm24kToMulaw(base64([0, 0, 0, 0, 0])))).toEqual(Buffer.from([0xff]));
  });

  it("attenuates above-Nyquist energy before it can alias into telephone speech", () => {
    function rms(frequency: number) {
      const wave = pcm(Array.from({ length: 12000 }, (_, i) => Math.round(12000 * Math.sin(2 * Math.PI * frequency * i / 24000))));
      const decoded = samples(mulawToPcm16k(pcm24kToMulaw(base64(wave)))).slice(256);
      return Math.sqrt(decoded.reduce((sum, sample) => sum + sample * sample, 0) / decoded.length);
    }
    const speechBand = rms(1000);
    const aliasBand = rms(5000);
    expect(speechBand).toBeGreaterThan(7000);
    expect(aliasBand / speechBand).toBeLessThan(0.02);
  });
});

describe("stream reset and bounded audio validation", () => {
  it("clears interrupted output without contaminating the next response", () => {
    const codec = createAudioCodec();
    codec.pcm24kToMulaw(base64(pcm(Array(71).fill(18000))));
    codec.pcm24kToMulaw(base64([255]));
    codec.resetOutput();
    const silent = base64(pcm(Array(96).fill(0)));
    expect(codec.pcm24kToMulaw(silent)).toBe(pcm24kToMulaw(silent));
  });

  it("resets input interpolation separately and can reset both streams", () => {
    const codec = createAudioCodec();
    codec.mulawToPcm16k(base64([0x80]));
    codec.resetInput();
    expect(samples(codec.mulawToPcm16k(base64([0xff])))).toEqual([0, 0]);
    codec.mulawToPcm16k(base64([0x00]));
    codec.pcm24kToMulaw(base64(pcm([8000, 8000])));
    codec.reset();
    expect(samples(codec.mulawToPcm16k(base64([0xff])))).toEqual([0, 0]);
    expect(codec.pcm24kToMulaw(base64(pcm([0])))).toBe("");
  });

  it.each(["a", "@@==", "AA=", "AAAA=", "A===", "AA==\n", "AB=="])(
    "rejects malformed or noncanonical base64: %s", (input) => {
      expect(() => mulawToPcm16k(input)).toThrow("invalid_audio_base64");
      expect(() => pcm24kToMulaw(input)).toThrow("invalid_audio_base64");
    },
  );

  it("accepts empty payloads and rejects standalone clips split inside a PCM sample", () => {
    expect(mulawToPcm16k("")).toBe("");
    expect(pcm24kToMulaw("")).toBe("");
    expect(() => pcm24kToMulaw(base64([0]))).toThrow("invalid_pcm_alignment");
  });

  it("rejects more than 64 KiB of decoded input before conversion", () => {
    const oversized = base64(new Uint8Array(65537));
    expect(() => mulawToPcm16k(oversized)).toThrow("audio_chunk_too_large");
    expect(() => pcm24kToMulaw(oversized)).toThrow("audio_chunk_too_large");
    expect(() => createAudioCodec().pcm24kToMulaw(oversized)).toThrow("audio_chunk_too_large");
    expect(bytes(mulawToPcm16k(base64(new Uint8Array(65536))))).toHaveLength(65536 * 4);
  });

  it("does not corrupt an in-progress stream after rejecting malformed input", () => {
    const codec = createAudioCodec();
    const first = codec.pcm24kToMulaw(base64(pcm([1000, 2000])));
    expect(() => codec.pcm24kToMulaw("bad!")).toThrow();
    const second = codec.pcm24kToMulaw(base64(pcm([3000, 4000, 5000, 6000])));
    expect(joinOutputs([first, second])).toEqual(bytes(pcm24kToMulaw(base64(pcm([1000, 2000, 3000, 4000, 5000, 6000])))));
  });
});
