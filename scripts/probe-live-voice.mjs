#!/usr/bin/env node
// Synthetic production HTTP/WebSocket rehearsal. This script never invokes the
// Twilio Calls or Messages APIs. Every capability is minted with InternalTest=true.
import { randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
import twilio from 'twilio';

const APP_ORIGIN = 'https://phone.leyardny.com';
const ENV_PATH = '/tmp/le-yard-live-voice-prod.env';
const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT = join(ROOT, 'output/voice-live');
const FRAME_BYTES = 160;
const FRAME_MS = 20;
const CASE_LIMIT_MS = 45_000;
const MAX_AUDIO_BYTES = 8000 * 60;
const SILENCE = Buffer.alloc(FRAME_BYTES, 0xff);
const CASES = [
  { name: 'reservation', bargeIn: false },
  { name: 'address', bargeIn: true },
  { name: 'human', bargeIn: false },
];

function check(condition, code) {
  if (!condition) throw new Error(code);
}

function safeError(error) {
  // Never serialize a fetch/WebSocket Error or provider error text; these can
  // include credential-bearing transport details.
  const message = error instanceof Error ? error.message : '';
  return /^probe_[a-z0-9_]+$/.test(message) ? message : 'probe_unexpected_failure';
}

function decodeXml(text) {
  return text.replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([A-Za-z]+)="([^"]*)"/g)]
    .map((match) => [match[1], decodeXml(match[2])]));
}

async function boundedResponse(response, maximum = 16_000) {
  check(response.body, 'probe_missing_response');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      check(length <= maximum, 'probe_response_too_large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function capability(env) {
  const callSid = `CA${randomBytes(16).toString('hex')}`;
  const streamSid = `MZ${randomBytes(16).toString('hex')}`;
  const to = (env.TWILIO_FROM_NUMBER || env.TWILIO_PHONE_NUMBER || '').trim();
  check(/^\+[1-9]\d{7,14}$/.test(to), 'probe_missing_shared_number');
  check(/^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID || ''), 'probe_missing_account');
  check(Boolean(env.TWILIO_AUTH_TOKEN?.trim()), 'probe_missing_webhook_credential');
  const params = {
    AccountSid: env.TWILIO_ACCOUNT_SID.trim(), CallSid: callSid,
    From: '+12025550100', To: to, Direction: 'inbound', CallStatus: 'in-progress',
    InternalTest: 'true', VoiceEngine: 'live', Timestamp: String(Math.floor(Date.now() / 1000)),
  };
  const endpoint = `${APP_ORIGIN}/api/twilio/voice/incoming`;
  const signature = twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN.trim(), endpoint, params);
  const response = await fetch(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature },
    body: new URLSearchParams(params),
  });
  check(response.ok, `probe_incoming_http_${response.status}`);
  const xml = await boundedResponse(response);
  check(!/<Dial\b|<Number\b/.test(xml), 'probe_unexpected_live_dial');
  const streams = [...xml.matchAll(/<Stream\b[^>]*>/g)];
  check(streams.length === 1 && /<Connect>/.test(xml), 'probe_stream_not_deployed');
  const stream = new URL(attributes(streams[0][0]).url);
  check(stream.protocol === 'wss:' && stream.pathname === '/stream' && !stream.search
    && !stream.hash && !stream.username && !stream.password, 'probe_invalid_stream_url');
  const parameters = [...xml.matchAll(/<Parameter\b[^>]*\/?\s*>/g)].map((match) => attributes(match[0]));
  const token = parameters.find((item) => item.name === 'token')?.value;
  check(typeof token === 'string' && token.length >= 50 && token.length < 495, 'probe_missing_test_capability');
  return { callSid, streamSid, accountSid: params.AccountSid, token, streamUrl: stream.href };
}

// Non-PCM WAV uses WAVE_FORMAT_MULAW, a fact chunk and explicit sample count.
function mulawWav(audio) {
  const padding = audio.length % 2;
  const wav = Buffer.alloc(58 + audio.length + padding);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(18, 16);
  wav.writeUInt16LE(7, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.writeUInt16LE(0, 36);
  wav.write('fact', 38); wav.writeUInt32LE(4, 42); wav.writeUInt32LE(audio.length, 46);
  wav.write('data', 50); wav.writeUInt32LE(audio.length, 54); audio.copy(wav, 58);
  return wav;
}

function speechBounds(audio) {
  let first = -1;
  let last = -1;
  for (let index = 0; index < audio.length; index += 1) {
    const code = (~audio[index]) & 255;
    const magnitude = (((code & 15) << 3) + 132) * (2 ** ((code >> 4) & 7)) - 132;
    if (magnitude > 500) {
      if (first === -1) first = index;
      last = index;
    }
  }
  check(first >= 0, 'probe_fixture_has_no_speech');
  return { first, last };
}

async function confirmSuppressed(cap, action) {
  const response = await fetch(`${APP_ORIGIN}/api/twilio/voice/live/action`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: cap.token, callSid: cap.callSid, action }),
  });
  check(response.ok, 'probe_internal_action_failed');
  const result = JSON.parse(await boundedResponse(response, 2000));
  check(result.ok === true && result.suppressed === true && result.action === action, 'probe_action_not_suppressed');
  return true;
}

async function runCase(spec, env, runId) {
  const fixture = await readFile(join(OUTPUT, `caller-${spec.name}.ulaw`));
  check(fixture.length > 0 && fixture.length <= 8000 * 15, 'probe_invalid_fixture_size');
  const speech = speechBounds(fixture);
  const begin = performance.now();
  const cap = await capability(env);
  const webhookMs = Math.round(performance.now() - begin);
  const socket = new WebSocket(cap.streamUrl);
  socket.binaryType = 'arraybuffer';
  const result = {
    case: spec.name, bargeIn: spec.bargeIn, webhookMs, greetingFirstAudioMs: null,
    firstResponseAudioMs: null, firstResponseAudibleMs: null, interruptionClearMs: null,
    greetingTranscript: '', inputTranscript: '', responseTranscript: '',
    action: null, actionSuppressed: false, diagnosticReady: false, transportErrors: [],
    observedClearCount: 0, fixtureSeconds: fixture.length / 8000,
    receivedAudioSeconds: 0, heardAudioSeconds: 0, checks: {}, events: [],
  };
  const received = [];
  const heard = [];
  const playback = [];
  let receivedBytes = 0;
  let heardBytes = 0;
  let openedAt;
  let firstAudioAt;
  let readyAt;
  let callerStartedAt;
  let callerSpeechEndAt;
  let callerCursor = 0;
  let sourceFinishedAt;
  let greetingTurnComplete = false;
  let responseTurnComplete = false;
  let greetingDone = false;
  let finishAt;
  let sequence = 0;
  let chunk = 0;
  let terminal = false;
  let timer;
  let overall;
  let errorCode;

  function event(kind, details = {}) {
    if (result.events.length < 180) result.events.push({ ms: Math.round(performance.now() - begin), kind, ...details });
  }
  function send(value) {
    check(socket.readyState === WebSocket.OPEN, 'probe_socket_closed');
    check(socket.bufferedAmount <= 128_000, 'probe_transport_backpressure');
    socket.send(JSON.stringify(value));
  }
  function acknowledge(name) {
    if (socket.readyState === WebSocket.OPEN) send({
      event: 'mark', sequenceNumber: String(++sequence), streamSid: cap.streamSid, mark: { name },
    });
  }
  function settle(error) {
    if (terminal) return;
    terminal = true;
    errorCode = error;
    clearInterval(timer); clearTimeout(overall);
    if (socket.readyState === WebSocket.OPEN) {
      try { send({ event: 'stop', sequenceNumber: String(++sequence), streamSid: cap.streamSid,
        stop: { accountSid: cap.accountSid, callSid: cap.callSid } }); } catch { /* Safe shutdown. */ }
    }
    if (socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Synthetic test complete');
  }
  function appendText(field, text) {
    if (typeof text === 'string') result[field] = `${result[field]}${text}`.slice(0, 10_000);
  }
  function tick() {
    if (terminal || socket.readyState !== WebSocket.OPEN) return;
    try {
      const now = performance.now();
      if (!callerStartedAt && result.diagnosticReady && firstAudioAt
        && (spec.bargeIn ? now >= firstAudioAt + 350 : greetingDone)) {
        callerStartedAt = now;
        callerSpeechEndAt = now + ((speech.last + 1) / 8);
        event('caller-start');
      }
      const input = Buffer.from(SILENCE);
      if (callerStartedAt && callerCursor < fixture.length) {
        if (speech.last >= callerCursor && speech.last < callerCursor + FRAME_BYTES) {
          callerSpeechEndAt = now + ((speech.last - callerCursor + 1) / 8);
        }
        fixture.copy(input, 0, callerCursor, Math.min(fixture.length, callerCursor + FRAME_BYTES));
        callerCursor += FRAME_BYTES;
        if (callerCursor >= fixture.length) {
          sourceFinishedAt = now + FRAME_MS;
          event('caller-finished');
        }
      }
      send({ event: 'media', sequenceNumber: String(++sequence), streamSid: cap.streamSid,
        media: { track: 'inbound', chunk: String(++chunk), timestamp: String(chunk * FRAME_MS), payload: input.toString('base64') } });

      // Simulate handset playout and Twilio mark receipts, including audio discarded
      // by clear. This also exercises the Worker's bounded announcement drain.
      const output = Buffer.from(SILENCE);
      let fill = 0;
      while (playback.length && fill < FRAME_BYTES) {
        const item = playback[0];
        if (item.mark) { acknowledge(item.mark); playback.shift(); continue; }
        const count = Math.min(FRAME_BYTES - fill, item.audio.length - item.offset);
        item.audio.copy(output, fill, item.offset, item.offset + count);
        if (callerSpeechEndAt && now >= callerSpeechEndAt && item.response && result.firstResponseAudibleMs === null) {
          result.firstResponseAudibleMs = Math.max(0, Math.round(now - callerSpeechEndAt));
        }
        fill += count; item.offset += count;
        if (item.offset >= item.audio.length) playback.shift();
      }
      // Marks exactly at a frame boundary are acknowledged without another20ms wait.
      while (playback[0]?.mark) { acknowledge(playback[0].mark); playback.shift(); }
      if (firstAudioAt && heardBytes < MAX_AUDIO_BYTES) {
        heard.push(output); heardBytes += output.length;
      }
      if (!callerStartedAt && greetingTurnComplete && !playback.length) greetingDone = true;
      if (sourceFinishedAt && responseTurnComplete && !playback.length && !finishAt) finishAt = now + 600;
      if (finishAt && now >= finishAt) settle();
    } catch (error) {
      settle(safeError(error));
    }
  }

  await new Promise((resolveDone) => {
    const resolveOnce = () => { settle(errorCode); resolveDone(); };
    overall = setTimeout(() => { settle('probe_case_timeout'); resolveDone(); }, CASE_LIMIT_MS);
    socket.addEventListener('open', () => {
      openedAt = performance.now();
      event('socket-open');
      send({ event: 'connected', protocol: 'Call', version: '1.0.0' });
      send({ event: 'start', sequenceNumber: String(++sequence), streamSid: cap.streamSid,
        start: { accountSid: cap.accountSid, callSid: cap.callSid, streamSid: cap.streamSid,
          tracks: ['inbound'], customParameters: { token: cap.token },
          mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 } } });
      timer = setInterval(() => { tick(); if (terminal) resolveDone(); }, FRAME_MS);
    });
    socket.addEventListener('message', (incoming) => {
      if (terminal) return;
      try {
        const raw = typeof incoming.data === 'string' ? incoming.data : new TextDecoder().decode(incoming.data);
        check(raw.length <= 128_000, 'probe_frame_too_large');
        const message = JSON.parse(raw);
        const now = performance.now();
        if (message.event === 'media') {
          check(message.streamSid === cap.streamSid, 'probe_media_call_mismatch');
          const bytes = Buffer.from(message.media.payload, 'base64');
          receivedBytes += bytes.length;
          check(receivedBytes <= MAX_AUDIO_BYTES, 'probe_audio_limit');
          received.push(bytes);
          firstAudioAt ??= now;
          result.greetingFirstAudioMs ??= Math.round(firstAudioAt - openedAt);
          const response = Boolean(callerSpeechEndAt && now >= callerSpeechEndAt);
          if (response && result.firstResponseAudioMs === null) {
            result.firstResponseAudioMs = Math.max(0, Math.round(now - callerSpeechEndAt));
            event('response-audio');
          }
          playback.push({ audio: bytes, offset: 0, response });
        } else if (message.event === 'mark') {
          check(message.streamSid === cap.streamSid, 'probe_mark_call_mismatch');
          playback.push({ mark: message.mark.name });
        } else if (message.event === 'clear') {
          result.observedClearCount += 1;
          if (callerStartedAt && result.interruptionClearMs === null) {
            result.interruptionClearMs = Math.max(0, Math.round(now - callerStartedAt - speech.first / 8));
          }
          for (const item of playback) if (item.mark) acknowledge(item.mark);
          playback.length = 0;
          event('clear');
        } else if (message.event === 'diagnostic') {
          if (message.kind === 'ready') {
            readyAt = now; result.diagnosticReady = true; event('ready');
          } else if (message.kind === 'transcript') {
            appendText(callerStartedAt ? 'responseTranscript' : 'greetingTranscript', message.text);
          } else if (message.kind === 'input-transcript') {
            appendText('inputTranscript', message.text);
          } else if (message.kind === 'turn-complete') {
            if (callerStartedAt && now > callerSpeechEndAt) responseTurnComplete = true;
            else greetingTurnComplete = true;
            event('turn-complete');
          } else if (message.kind === 'action') {
            check(['handoff', 'voicemail', 'end'].includes(message.text), 'probe_unknown_action');
            result.action = message.text; event('action', { action: message.text });
          } else if (message.kind === 'error') {
            const code = /^[a-z_]{1,80}$/.test(message.text || '') ? message.text : 'worker_error';
            result.transportErrors.push(code); event('worker-error', { code });
          }
        } else {
          throw new Error('probe_unexpected_protocol');
        }
      } catch (error) {
        settle(safeError(error)); resolveDone();
      }
    });
    socket.addEventListener('close', (closed) => {
      if (!terminal && !result.action && !responseTurnComplete) errorCode = 'probe_early_close';
      result.closeCode = closed.code;
      result.closeCategory = /^[a-z][a-z0-9_]{0,60}$/.test(closed.reason) ? closed.reason : 'unspecified';
      event('socket-close', { code: result.closeCode, category: result.closeCategory }); resolveOnce();
    });
    socket.addEventListener('error', () => { settle('probe_socket_error'); resolveDone(); });
  });

  if (result.action) {
    try { result.actionSuppressed = await confirmSuppressed(cap, result.action); }
    catch (error) { errorCode = safeError(error); }
  }
  result.receivedAudioSeconds = receivedBytes / 8000;
  result.heardAudioSeconds = heardBytes / 8000;
  result.readyMs = readyAt ? Math.round(readyAt - openedAt) : null;
  result.totalMs = Math.round(performance.now() - begin);
  result.failure = errorCode ?? null;
  const transcript = `${result.greetingTranscript} ${result.responseTranscript}`;
  result.checks = {
    authenticatedInternalSession: result.diagnosticReady,
    greetingAudio: result.greetingFirstAudioMs !== null,
    noScriptedAiIntroduction: !/\b(?:AI (?:assistant|receptionist)|artificial intelligence)\b/i.test(transcript),
    callerTranscribed: result.inputTranscript.trim().length >= 8,
    noTransportError: !result.failure && result.transportErrors.length === 0,
    ...(spec.name === 'reservation' ? {
      reservationUnderstood: /reserv|book|table|party|guest/i.test(result.responseTranscript),
      spokenResponse: result.firstResponseAudioMs !== null,
      noUnsupportedNotificationOffer: !/\b(?:(?:can|could|shall|should|may) (?:I|we)|(?:I|we) (?:can|could|will|shall)|(?:I|we)['’]ll|would you like (?:me|us) to|do you want (?:me|us) to|let (?:me|us))\b.{0,90}\b(?:let you know|notify|text|email|message you|call you back|keep you posted|waitlist|subscribe|follow.?up)/i.test(result.responseTranscript),
    } : {}),
    ...(spec.name === 'address' ? {
      addressUnderstood: /858|eight[- ]fifty[- ]eight|eight hundred (?:and )?fifty[- ]eight/i.test(result.responseTranscript)
        && /ninth|9th/i.test(result.responseTranscript),
      bargeInClearedPlayback: result.interruptionClearMs !== null,
      spokenResponse: result.firstResponseAudioMs !== null,
    } : {}),
    ...(spec.name === 'human' ? { humanHandoffRequested: result.action === 'handoff', actionSuppressed: result.actionSuppressed } : {}),
  };
  result.passed = Object.values(result.checks).every(Boolean);
  const prefix = `${runId}-${spec.name}`;
  result.artifacts = { generated: `${prefix}-received.wav`, heard: `${prefix}-heard.wav`, caller: `${prefix}-caller.wav` };
  await Promise.all([
    writeFile(join(OUTPUT, result.artifacts.generated), mulawWav(Buffer.concat(received)), { mode: 0o600 }),
    writeFile(join(OUTPUT, result.artifacts.heard), mulawWav(Buffer.concat(heard)), { mode: 0o600 }),
    writeFile(join(OUTPUT, result.artifacts.caller), mulawWav(fixture), { mode: 0o600 }),
    writeFile(join(OUTPUT, `${prefix}.json`), JSON.stringify(result, null, 2), { mode: 0o600 }),
  ]);
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const selected = args.find((argument) => argument.startsWith('--case='))?.slice(7);
  check(!selected || CASES.some((item) => item.name === selected), 'probe_unknown_case');
  const cases = selected ? CASES.filter((item) => item.name === selected) : CASES;
  await mkdir(OUTPUT, { recursive: true, mode: 0o700 });
  for (const spec of cases) {
    const fixture = await readFile(join(OUTPUT, `caller-${spec.name}.ulaw`));
    check(fixture.length <= 8000 * 15, 'probe_invalid_fixture_size');
    speechBounds(fixture);
  }
  if (!args.includes('--run')) {
    console.log(JSON.stringify({ ready: true, cases: cases.map((item) => item.name),
      runCommand: 'node scripts/probe-live-voice.mjs --run', callCreated: false, messageSent: false }));
    return;
  }
  const env = parseEnv(await readFile(ENV_PATH, 'utf8'));
  if (args.includes('--check-broker')) {
    const cap = await capability(env);
    const streamUrl = new URL(cap.streamUrl); streamUrl.protocol = 'https:';
    const response = await fetch(`${APP_ORIGIN}/api/twilio/voice/live/session`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: cap.token, callSid: cap.callSid, accountSid: cap.accountSid,
        streamUrl: streamUrl.href, twilioSignature: '' }),
    });
    const body = await boundedResponse(response, 96_000);
    let value; try { value = JSON.parse(body); } catch { value = {}; }
    console.log(JSON.stringify({ brokerStatus: response.status, callBound: value.callSid === cap.callSid,
      internalTest: value.internalTest === true, ephemeralAuth: /^Token auth_tokens\//.test(value.gemini?.headers?.Authorization || ''),
      callCreated: false, messageSent: false }));
    return;
  }
  const runId = `production-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const results = [];
  for (const spec of cases) {
    try {
      const result = await runCase(spec, env, runId);
      results.push(result);
      // Synthetic fixture text is kept in the bounded local report, not console logs.
      console.log(JSON.stringify({ case: result.case, passed: result.passed,
        greetingFirstAudioMs: result.greetingFirstAudioMs, firstResponseAudioMs: result.firstResponseAudioMs,
        firstResponseAudibleMs: result.firstResponseAudibleMs, interruptionClearMs: result.interruptionClearMs,
        action: result.action, actionSuppressed: result.actionSuppressed, failure: result.failure,
        closeCode: result.closeCode, closeCategory: result.closeCategory }));
    } catch (error) {
      const failed = { case: spec.name, passed: false, failure: safeError(error) };
      results.push(failed); console.log(JSON.stringify(failed));
    }
  }
  const summary = { internalOnly: true, callCreated: false, messageSent: false,
    runId, passed: results.every((item) => item.passed), results };
  const report = join(OUTPUT, `${runId}-summary.json`);
  await writeFile(report, JSON.stringify(summary, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ passed: summary.passed, report, callCreated: false, messageSent: false }));
  if (!summary.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ failure: safeError(error), callCreated: false, messageSent: false }));
  process.exitCode = 1;
});
