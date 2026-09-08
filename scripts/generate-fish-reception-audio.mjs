import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const apiKey = process.env.FISH_API_KEY?.trim();
if (!apiKey) throw new Error("FISH_API_KEY is required.");

const text =
  process.env.FISH_RECEPTION_TEXT?.trim() ||
  "Hey, thanks for calling Le Yard! Give us just a moment, and we'll connect you with the team.";
// Hannah is a Fish Official voice; accent direction remains a listening-review item.
const referenceId = process.env.FISH_REFERENCE_ID?.trim() || "9a9cf47702da476aa4629e2506d4a857";
const direction = process.env.FISH_RECEPTION_DIRECTION?.trim() ||
  "Bright, smiling, welcoming, casual New York City accent, natural conversational rhythm";
const model = process.env.FISH_MODEL?.trim() || "s2.1-pro-free";
const format = process.env.FISH_RECEPTION_FORMAT?.trim() || "wav";
if (!["wav", "mp3"].includes(format)) throw new Error("FISH_RECEPTION_FORMAT must be wav or mp3.");
const output = resolve(
  process.cwd(),
  process.env.FISH_RECEPTION_OUTPUT?.trim() || `output/reception-voice.${format}`,
);

const body = {
  text: `[${direction}] ${text}`,
  format,
  reference_id: referenceId,
  latency: "normal",
  temperature: 0.7,
  top_p: 0.7,
  prosody: { speed: 0.97, volume: 0, normalize_loudness: true },
};
const response = await fetch("https://api.fish.audio/v1/tts", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    model,
  },
  signal: AbortSignal.timeout(60_000),
  body: JSON.stringify(body),
});

if (!response.ok) {
  throw new Error(`Fish Audio generation failed (${response.status}).`);
}

const audio = Buffer.from(await response.arrayBuffer());
if (audio.length < 1024 || !response.headers.get("content-type")?.startsWith("audio/")) {
  throw new Error("Fish Audio did not return a usable audio file.");
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, audio);
console.log(`Generated ${output} with ${model} (${audio.length} bytes).`);
