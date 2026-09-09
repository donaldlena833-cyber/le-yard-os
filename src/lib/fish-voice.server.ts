import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";

const SAMPLE_RATE = 16_000;
const VOICE_ID = "9a9cf47702da476aa4629e2506d4a857";
const AUDIO_VERSION = "hannah-room-v1";
const MAX_AUDIO_BYTES = SAMPLE_RATE * 2 * 90;
const FISH_TIMEOUT_MS = 5_500;
const PUBLISH_TIMEOUT_MS = 7_500;
const BUCKET = "voice-reception";

type PcmAudio = { samples: Int16Array; sampleRate: number };
let roomTonePromise: Promise<PcmAudio> | undefined;

function speechText(text: string) {
  const value = text.replace(/\s+/g, " ").trim().slice(0, 450);
  if (!value) throw new Error("Voice speech text is empty");
  return value;
}

function voiceModel() {
  const model = process.env.FISH_VOICE_MODEL?.trim() || "s2.1-pro-free";
  if (!/^[a-z0-9.-]{1,48}$/i.test(model)) throw new Error("Voice model is invalid");
  return model;
}

async function withinDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Voice audio timed out");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Voice audio timed out")), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pcmSamples(bytes: Buffer) {
  if (bytes.length < 2 || bytes.length % 2) throw new Error("Voice audio format is invalid");
  const samples = new Int16Array(bytes.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = bytes.readInt16LE(index * 2);
  }
  return samples;
}

function decodeWav(bytes: Buffer): PcmAudio {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Voice audio format is invalid");
  }
  let format: { channels: number; sampleRate: number } | undefined;
  let audio: Buffer | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > bytes.length) throw new Error("Voice audio format is invalid");
    if (kind === "fmt ") {
      if (length < 16 || bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start + 14) !== 16) {
        throw new Error("Voice audio format is invalid");
      }
      const channels = bytes.readUInt16LE(start + 2);
      const sampleRate = bytes.readUInt32LE(start + 4);
      if (![1, 2].includes(channels) || sampleRate < 8_000 || sampleRate > 48_000 || bytes.readUInt16LE(start + 12) !== channels * 2) {
        throw new Error("Voice audio format is invalid");
      }
      format = { channels, sampleRate };
    } else if (kind === "data") {
      audio = bytes.subarray(start, start + length);
    }
    offset = start + length + (length % 2);
  }
  if (!format || !audio || audio.length % (format.channels * 2)) throw new Error("Voice audio format is invalid");
  const source = pcmSamples(audio);
  if (format.channels === 1) return { samples: source, sampleRate: format.sampleRate };
  const mono = new Int16Array(source.length / 2);
  for (let index = 0; index < mono.length; index += 1) {
    mono[index] = Math.round((source[index * 2] + source[index * 2 + 1]) / 2);
  }
  return { samples: mono, sampleRate: format.sampleRate };
}

function at16k(audio: PcmAudio) {
  if (audio.sampleRate === SAMPLE_RATE) return audio.samples;
  const output = new Int16Array(Math.floor(audio.samples.length * SAMPLE_RATE / audio.sampleRate));
  for (let index = 0; index < output.length; index += 1) {
    const position = index * audio.sampleRate / SAMPLE_RATE;
    const left = Math.floor(position);
    const fraction = position - left;
    output[index] = Math.round(audio.samples[left] * (1 - fraction) + audio.samples[Math.min(left + 1, audio.samples.length - 1)] * fraction);
  }
  return output;
}

async function roomTone() {
  roomTonePromise ??= readFile(path.join(process.cwd(), "public/audio/le-yard-room-tone.wav"))
    .then(decodeWav)
    .catch(() => {
      roomTonePromise = undefined;
      throw new Error("Voice room audio is unavailable");
    });
  return roomTonePromise;
}

function encodeMixedWav(voice: Int16Array, ambient: Int16Array, seed: string) {
  if (!voice.length || !ambient.length) throw new Error("Voice audio format is invalid");
  const wav = Buffer.alloc(44 + voice.length * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(voice.length * 2, 40);

  let sumSquares = 0;
  for (const sample of ambient) sumSquares += sample * sample;
  const rms = Math.sqrt(sumSquares / ambient.length);
  // Room tone sits around -40 dBFS in pauses and ducks another 9 dB under speech.
  const roomGain = rms > 0 ? Math.min(1, 328 / rms) : 0;
  const start = createHash("sha256").update(seed).digest().readUInt32LE(0) % ambient.length;
  const fadeSamples = Math.round(SAMPLE_RATE * 0.015);
  let envelope = 0;
  for (let index = 0; index < voice.length; index += 1) {
    envelope += (Math.abs(voice[index]) - envelope) * 0.008;
    const duck = 1 - 0.65 * Math.min(1, envelope / 1_300);
    const fade = Math.min(1, index / fadeSamples, (voice.length - 1 - index) / fadeSamples);
    const room = ambient[(start + index) % ambient.length] * roomGain * duck;
    const mixed = Math.round((voice[index] * 0.94 + room) * fade);
    wav.writeInt16LE(Math.max(-32768, Math.min(32767, mixed)), 44 + index * 2);
  }
  return wav;
}

async function generateSpeech(text: string, model: string, deadline: number): Promise<Buffer> {
  const apiKey = process.env.FISH_API_KEY?.trim();
  if (!apiKey) throw new Error("Fish voice is not configured");
  const controller = new AbortController();
  const remaining = Math.min(FISH_TIMEOUT_MS, deadline - Date.now());
  if (remaining <= 0) throw new Error("Voice audio timed out");
  const timer = setTimeout(() => controller.abort(), remaining);
  try {
    const operation = async () => {
      const [response, ambience] = await Promise.all([
        fetch("https://api.fish.audio/v1/tts", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", model },
          body: JSON.stringify({
            text,
            reference_id: VOICE_ID,
            format: "pcm",
            sample_rate: SAMPLE_RATE,
            latency: "low",
            normalize: true,
            prosody: { speed: 0.97, volume: 0 },
          }),
          signal: controller.signal,
          cache: "no-store",
        }),
        roomTone(),
      ]);
      if (!response.ok || !response.body) throw new Error("Fish voice is unavailable");
      const contentType = response.headers.get("content-type")?.toLowerCase() || "";
      if (contentType.includes("json") || contentType.startsWith("text/")) throw new Error("Fish voice returned invalid audio");
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let length = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.length;
          if (length > MAX_AUDIO_BYTES) throw new Error("Fish voice returned invalid audio");
          chunks.push(Buffer.from(chunk.value));
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const audio = Buffer.concat(chunks);
      const voice = audio.toString("ascii", 0, 4) === "RIFF" ? at16k(decodeWav(audio)) : pcmSamples(audio);
      return encodeMixedWav(voice, at16k(ambience), text);
    };
    return await withinDeadline(operation(), Date.now() + remaining);
  } catch {
    throw new Error("Fish voice synthesis failed");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** Produces telephone-ready PCM WAV without recording or calling any recipient. */
export async function synthesizeReceptionSpeech(text: string): Promise<Buffer> {
  return generateSpeech(speechText(text), voiceModel(), Date.now() + FISH_TIMEOUT_MS);
}

/** Uses a private, pre-provisioned bucket; public paths never contain guest speech. */
export async function publishReceptionSpeech(text: string): Promise<string> {
  const deadline = Date.now() + PUBLISH_TIMEOUT_MS;
  const normalized = speechText(text);
  const model = voiceModel();
  const day = new Date().toISOString().slice(0, 10);
  const key = `${AUDIO_VERSION}/${day}/${createHash("sha256").update(JSON.stringify([AUDIO_VERSION, model, VOICE_ID, normalized])).digest("hex")}.wav`;
  try {
    const bucket = createAdminClient().storage.from(BUCKET);
    const cached = await withinDeadline(bucket.info(key), deadline);
    if (!cached.data) {
      // Only a missing object may trigger paid synthesis; permission/outage errors fail closed.
      const cacheError = cached.error as { statusCode?: string; code?: string } | null;
      const isMissing = [cacheError?.statusCode, cacheError?.code]
        .some((code) => ["404", "not_found", "notfound", "nosuchkey"].includes(String(code).toLowerCase()));
      if (cacheError && !isMissing) {
        throw new Error("Voice audio cache is unavailable");
      }
      const audio = await generateSpeech(normalized, model, Math.min(deadline, Date.now() + FISH_TIMEOUT_MS));
      if (Date.now() >= deadline) throw new Error("Voice audio timed out");
      const uploaded = await withinDeadline(bucket.upload(key, audio, {
        contentType: "audio/wav",
        cacheControl: "3600",
        upsert: false,
      }), deadline);
      if (uploaded.error) {
        // A concurrent caller may have generated this exact phrase first.
        const existing = await withinDeadline(bucket.info(key), deadline);
        if (!existing.data || existing.error) throw new Error("Voice audio upload failed");
      }
    } else if (cached.error) {
      throw new Error("Voice audio cache is unavailable");
    }
    if (Date.now() >= deadline) throw new Error("Voice audio timed out");
    const signed = await withinDeadline(bucket.createSignedUrl(key, 600), deadline);
    if (signed.error || !signed.data?.signedUrl || !signed.data.signedUrl.startsWith("https://")) {
      throw new Error("Voice audio signing failed");
    }
    return signed.data.signedUrl;
  } catch {
    throw new Error("Reception voice audio is unavailable");
  }
}
