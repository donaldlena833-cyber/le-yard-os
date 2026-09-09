/** Signed synthetic HTTP conversation. NEVER creates a Twilio Call or Message. */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.TWILIO_PUBLIC_BASE_URL;
if (!base?.startsWith("https://") || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_ACCOUNT_SID) throw new Error("Protected Twilio environment required");
const to = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER;
const report = [];
function decode(value) { return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"'); }
function callback(xml) {
  const value = xml.match(/<Gather\b[^>]*action="([^"]+)"/)?.[1];
  assert(value, "Expected another conversation turn");
  const url = new URL(decode(value));
  assert.equal(url.origin, new URL(base).origin);
  assert.equal(url.pathname, "/api/twilio/voice/ai/turn");
  return url.href;
}
async function signed(url, callSid, fields = {}) {
  const data = { AccountSid: process.env.TWILIO_ACCOUNT_SID, To: to, From: "+12025550100", CallSid: callSid, ...fields };
  const signature = createHmac("sha1", process.env.TWILIO_AUTH_TOKEN).update(url + Object.keys(data).sort().map(key => key + data[key]).join("")).digest("base64");
  const started = Date.now();
  const response = await fetch(url, { method: "POST", redirect: "error", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature }, body: new URLSearchParams(data), signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `Voice callback HTTP ${response.status}`);
  const xml = await response.text();
  assert(!/<(?:Dial|Number|Client|Record|Redirect)\b/.test(xml), "Synthetic session attempted an external action");
  return { xml, latencyMs: Date.now() - started };
}
async function start() {
  const callSid = `CA${randomBytes(16).toString("hex")}`;
  const result = await signed(`${base}/api/twilio/voice/incoming`, callSid, { InternalTest: "true", Timestamp: String(Math.floor(Date.now() / 1000)) });
  assert(result.xml.includes('bargeIn="true"'));
  const greetingUrl = result.xml.match(/<Play>([^<]+)<\/Play>/)?.[1];
  assert(greetingUrl?.endsWith("/audio/le-yard-ai-welcome.wav"));
  const greeting = await fetch(decode(greetingUrl));
  assert.equal(greeting.status, 200);
  assert(Buffer.from(await greeting.arrayBuffer()).toString("ascii", 0, 4) === "RIFF");
  return { callSid, url: callback(result.xml) };
}

await mkdir("output/voice-reception", { recursive: true });
const conversation = await start();
for (const [label, speech] of [
  ["location", "Where are you located?"],
  ["new-reservation", "Can I book a table for two tomorrow at seven?"],
]) {
  const result = await signed(conversation.url, conversation.callSid, { SpeechResult: speech });
  const audioUrl = result.xml.match(/<Play>([^<]+)<\/Play>/)?.[1];
  assert(audioUrl, "Fish voice fell back; provider path is not fully passing");
  const audio = await fetch(decode(audioUrl));
  assert.equal(audio.status, 200);
  const bytes = Buffer.from(await audio.arrayBuffer());
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  await writeFile(`output/voice-reception/${label}.wav`, bytes);
  report.push({ scenario: label, passed: true, fishAudio: true, latencyMs: result.latencyMs });
  conversation.url = callback(result.xml);
}
const handoff = await signed(conversation.url, conversation.callSid, { SpeechResult: "Can I speak to Maris please?" });
assert(handoff.xml.includes("<Hangup"));
report.push({ scenario: "human-handoff-isolated", passed: true, latencyMs: handoff.latencyMs });

for (const [label, fields] of [["zero-key-isolated", { Digits: "0" }], ["voicemail-isolated", { SpeechResult: "voicemail" }]]) {
  const session = await start();
  const result = await signed(session.url, session.callSid, fields);
  assert(result.xml.includes("<Hangup"));
  report.push({ scenario: label, passed: true, latencyMs: result.latencyMs });
}
const silent = await start();
const firstSilence = await signed(silent.url, silent.callSid);
const secondSilence = await signed(callback(firstSilence.xml), silent.callSid);
assert(secondSilence.xml.includes("<Hangup"));
report.push({ scenario: "silence-ends-cleanly", passed: true });
const unauthenticated = await fetch(`${base}/api/twilio/voice/ai/turn`, { method: "POST", body: "" });
assert.equal(unauthenticated.status, 403);
report.push({ scenario: "unsigned-callback-rejected", passed: true });
const evidence = { testedAt: new Date().toISOString(), base, synthetic: true, callsCreated: 0, messagesCreated: 0, scenarios: report };
await writeFile("output/voice-reception/production-probe.json", JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence, null, 2));
