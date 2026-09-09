// Direct provider audio probe. Never places a Twilio call or sends a message.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const model = "models/gemini-3.1-flash-live-preview";
const voice = process.env.VOICE_PROBE_NAME || "Aoede";
const setup = { model, generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  systemInstruction: { parts: [{ text: await readFile("docs/le-yard-receptionist-live.md", "utf8") }] },
  realtimeInputConfig: { automaticActivityDetection: { disabled: false, prefixPaddingMs: 200, silenceDurationMs: 500 }, activityHandling: "START_OF_ACTIVITY_INTERRUPTS" },
  inputAudioTranscription: {}, outputAudioTranscription: {}, contextWindowCompression: { slidingWindow: {} } };
const tokenResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", { method: "POST",
  headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY.trim() },
  body: JSON.stringify({ uses: 1, expireTime: new Date(Date.now()+20*60000).toISOString(), newSessionExpireTime: new Date(Date.now()+60000).toISOString(), bidiGenerateContentSetup: setup }) });
assert.equal(tokenResponse.status, 200, "Ephemeral token request failed");
const token = await tokenResponse.json();
const endpoint = new URL("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained");
endpoint.searchParams.set("access_token", token.name);
const socket = new WebSocket(endpoint); socket.binaryType = "arraybuffer";
const started = Date.now(); let firstAudioAt; let transcript = ""; const audio = [];
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.close(); reject(new Error("Native audio probe timed out")); }, 20000);
  socket.addEventListener("open", () => socket.send(JSON.stringify({ setup })));
  socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Native audio transport failed")); });
  socket.addEventListener("close", event => { if (!audio.length) { clearTimeout(timer); reject(new Error(`Native audio closed (${event.code})`)); } });
  socket.addEventListener("message", event => {
    try {
      const message = JSON.parse(typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data));
      if (message.error) throw new Error(`Native provider error (${message.error.code || "unknown"})`);
      if (message.setupComplete) socket.send(JSON.stringify({ realtimeInput: { text: "A caller has just connected. Greet them using the exact opening line, then listen." } }));
      const content = message.serverContent;
      if (content?.outputTranscription?.text) transcript += content.outputTranscription.text;
      for (const part of content?.modelTurn?.parts || []) if (part.inlineData?.data) { firstAudioAt ??= Date.now(); audio.push(Buffer.from(part.inlineData.data, "base64")); }
      if (content?.turnComplete && audio.length) { clearTimeout(timer); socket.close(); resolve(); }
    } catch (error) { clearTimeout(timer); socket.close(); reject(error); }
  });
});
assert(!/AI (?:assistant|receptionist)/i.test(transcript), "Unexpected scripted AI introduction");
const pcm=Buffer.concat(audio),wav=Buffer.alloc(44+pcm.length);wav.write("RIFF");wav.writeUInt32LE(wav.length-8,4);wav.write("WAVEfmt ",8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write("data",36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);
await mkdir("output/voice-live", { recursive: true });
await writeFile(`output/voice-live/${voice.toLowerCase()}-greeting.wav`,wav);
console.log(JSON.stringify({ model,voice,firstAudioMs:firstAudioAt-started,durationSeconds:pcm.length/48000,transcript,callCreated:false }));
