import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const apiKey = process.env.FISH_API_KEY?.trim();
if (!apiKey) throw new Error("FISH_API_KEY is required.");

const text =
  process.env.FISH_RECEPTION_TEXT?.trim() ||
  "Thank you for calling Le Yard. One moment while we connect you with our team.";
const referenceId = process.env.FISH_REFERENCE_ID?.trim();
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
    model: "s2-pro",
  },
  body: JSON.stringify(body),
});

if (!response.ok) {
  throw new Error(`Fish Audio generation failed (${response.status}).`);
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, Buffer.from(await response.arrayBuffer()));
console.log(`Generated ${output}`);
