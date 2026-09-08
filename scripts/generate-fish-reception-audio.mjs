import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const apiKey = process.env.FISH_API_KEY?.trim();
if (!apiKey) throw new Error("FISH_API_KEY is required.");

const text =
  process.env.FISH_RECEPTION_TEXT?.trim() ||
  "Thank you for calling Le Yard. One moment while we connect you with our team.";
// Hannah is a Fish Official, AI-designed conversational voice.
const referenceId = process.env.FISH_REFERENCE_ID?.trim() || "9a9cf47702da476aa4629e2506d4a857";
const model = process.env.FISH_MODEL?.trim() || "s2.1-pro-free";
const output = resolve(
  process.cwd(),
  process.env.FISH_RECEPTION_OUTPUT?.trim() || "public/audio/le-yard-reception.mp3",
);

const body = { text, format: "mp3", ...(referenceId ? { reference_id: referenceId } : {}) };
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
