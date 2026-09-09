import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { createVoiceBridge } from '../../workers/voice-reception/src/worker.mjs';

const CALL = `CA${'1'.repeat(32)}`;
const ACCOUNT = `AC${'2'.repeat(32)}`;
const STREAM = `MZ${'3'.repeat(32)}`;
const TOKEN = 'sealed-call-capability-for-unit-test';
const GOOGLE_URL = 'https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const INPUT_AUDIO = Buffer.alloc(160, 0xff).toString('base64');
const OUTPUT_AUDIO = Buffer.alloc(960).toString('base64');

class Socket extends EventTarget {
  readyState = 0;
  binaryType = 'blob';
  bufferedAmount = 0;
  sent: string[] = [];
  closeCode?: number;
  closeReason?: string;
  accept() { this.readyState = 1; }
  send(value: string) {
    if (this.readyState !== 1) throw new Error('closed');
    this.sent.push(value);
  }
  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
  receive(value: unknown, binary = false) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    this.dispatchEvent(new MessageEvent('message', {
      data: binary ? new TextEncoder().encode(text).buffer : text,
    }));
  }
}

function messages(socket: Socket): Record<string, unknown>[] {
  return socket.sent.map((value) => JSON.parse(value));
}

function upgrade(socket: Socket) {
  const response = new Response(null);
  Object.defineProperties(response, { status: { value: 101 }, webSocket: { value: socket } });
  return response;
}

function session(internalTest = false) {
  return {
    callSid: CALL,
    internalTest,
    gemini: {
      url: GOOGLE_URL,
      headers: { Authorization: 'Token auth_tokens/unit-test-only', 'X-Ignored-Header': 'never-forward' },
      setup: {
        model: 'models/gemini-3.1-flash-live-preview',
        generationConfig: { responseModalities: ['AUDIO'] },
        sessionResumption: {},
      },
    },
  };
}

function startMessage(overrides = {}) {
  return {
    event: 'start', streamSid: STREAM,
    start: {
      callSid: CALL, accountSid: ACCOUNT, streamSid: STREAM,
      customParameters: { token: TOKEN },
      mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
      ...overrides,
    },
  };
}

function mediaMessage(payload = INPUT_AUDIO, streamSid = STREAM) {
  return { event: 'media', streamSid, media: { track: 'inbound', payload } };
}

async function flush() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

const bridges: ReturnType<typeof createVoiceBridge>[] = [];

function harness(options: {
  internalTest?: boolean;
  sessionBody?: unknown;
  sessionStatus?: number;
  sessionResponse?: Promise<Response>;
  actionResponse?: Promise<Response>;
  upstreamUrl?: string;
} = {}) {
  const twilio = new Socket();
  const google = new Socket();
  const resumed = new Socket();
  let upgrades = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/session')) {
      if (options.sessionResponse) return options.sessionResponse;
      const body = options.sessionBody ?? session(options.internalTest);
      return Response.json(body, { status: options.sessionStatus ?? 200 });
    }
    if (url.endsWith('/action')) return options.actionResponse ?? Response.json({ ok: true });
    if (url === (options.upstreamUrl ?? GOOGLE_URL)) {
      upgrades += 1;
      return upgrade(upgrades === 1 ? google : resumed);
    }
    throw new Error(`Unexpected test fetch ${url}, method ${init?.method}`);
  });
  const request = new Request('https://voice-reception.example/stream', {
    headers: { 'X-Twilio-Signature': 'test-provider-signature' },
  });
  const bridge = createVoiceBridge(twilio, request, {}, fetcher);
  bridges.push(bridge);
  async function ready() {
    twilio.receive(startMessage());
    await flush();
    google.receive({ setupComplete: {} }, true);
    await flush();
  }
  return { twilio, google, resumed, fetcher, bridge, ready };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('voice Live Worker HTTP surface', () => {
  it('provides a minimal health response and rejects non-WebSocket stream requests', async () => {
    const health = await worker.fetch(new Request('https://voice.example/health'), {});
    expect(await health.json()).toEqual({ status: 'up', version: 'streaming-native-v1' });
    expect(health.headers.get('cache-control')).toBe('no-store');
    expect((await worker.fetch(new Request('https://voice.example/stream'), {})).status).toBe(426);
    expect((await worker.fetch(new Request('https://voice.example/unknown'), {})).status).toBe(404);
  });

  it('rejects URL query capabilities before opening a socket', async () => {
    const response = await worker.fetch(new Request('https://voice.example/stream?token=unsafe', {
      headers: { Upgrade: 'websocket' },
    }), {});
    expect(response.status).toBe(400);
  });
});

describe('voice Live Worker protocol bridge', () => {
  it('preserves the global receiver for the Cloudflare fetch implementation', async () => {
    const twilioSocket = new Socket();
    const googleSocket = new Socket();
    const fetcher = vi.fn(function (this: unknown, input: RequestInfo | URL) {
      expect(this).toBe(globalThis);
      return Promise.resolve(String(input).endsWith('/session') ? Response.json(session()) : upgrade(googleSocket));
    });
    vi.stubGlobal('fetch', fetcher);
    bridges.push(createVoiceBridge(twilioSocket, new Request('https://voice.example/stream'), {}));
    twilioSocket.receive(startMessage());
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(googleSocket.readyState).toBe(1);
  });
  it('binds authentication to Twilio start and forwards only ephemeral Google auth', async () => {
    const h = harness();
    await h.ready();
    expect(h.twilio.binaryType).toBe('arraybuffer');
    expect(h.google.binaryType).toBe('arraybuffer');
    const sessionRequest = h.fetcher.mock.calls[0];
    expect(sessionRequest[1]?.redirect).toBe('manual');
    expect(sessionRequest[0]).toBe('https://phone.leyardny.com/api/twilio/voice/live/session');
    expect(JSON.parse(String(sessionRequest[1]?.body))).toEqual({
      token: TOKEN, callSid: CALL, accountSid: ACCOUNT,
      streamUrl: 'https://voice-reception.example/stream', twilioSignature: 'test-provider-signature',
    });
    expect(h.fetcher.mock.calls[1][1]?.headers).toEqual({
      Upgrade: 'websocket', Authorization: 'Token auth_tokens/unit-test-only',
    });
    expect(h.fetcher.mock.calls[1][1]?.redirect).toBe('manual');
    expect(messages(h.google)[0]).toMatchObject({ setup: { model: 'models/gemini-3.1-flash-live-preview' } });
    expect(messages(h.google)[1]).toMatchObject({ realtimeInput: { text: expect.stringContaining('Thanks for calling Le Yard. How can I help?') } });
    expect(h.twilio.sent).toHaveLength(0);
  });

  it('holds caller audio through setup, then forwards it as PCM16k without dropping the first syllable', async () => {
    const h = harness();
    h.twilio.receive(startMessage());
    h.twilio.receive(mediaMessage());
    await flush();
    expect(messages(h.google)).toHaveLength(1);
    h.google.receive({ setupComplete: {} });
    const sent = messages(h.google);
    expect(sent[2]).toEqual({ realtimeInput: { audio: {
      mimeType: 'audio/pcm;rate=16000', data: Buffer.alloc(640).toString('base64'),
    } } });
    h.twilio.receive(mediaMessage());
    expect(messages(h.google)).toHaveLength(4);
  });

  it('streams every audio part immediately, marks turns and clears interrupted playback', async () => {
    const h = harness();
    await h.ready();
    h.google.receive({ serverContent: {
      modelTurn: { parts: [
        { inlineData: { mimeType: 'audio/pcm;rate=24000', data: OUTPUT_AUDIO } },
        { text: 'ignored internal text' },
        { inlineData: { mimeType: 'audio/pcm;rate=24000', data: OUTPUT_AUDIO } },
      ] },
      outputTranscription: { text: 'private spoken reply' }, turnComplete: true,
    } });
    expect(messages(h.twilio).map((message) => message.event)).toEqual(['media', 'media', 'mark']);
    expect(messages(h.twilio)[0]).toMatchObject({
      streamSid: STREAM, media: { payload: Buffer.alloc(160, 0xff).toString('base64') },
    });
    h.google.receive({ serverContent: {
      interrupted: true,
      modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: OUTPUT_AUDIO } }] },
    } });
    expect(messages(h.twilio).at(-1)).toEqual({ event: 'clear', streamSid: STREAM });
    expect(messages(h.twilio).filter((message) => message.event === 'media')).toHaveLength(2);
  });

  it('exposes diagnostics only after the broker has authorized an internal test', async () => {
    const h = harness({ internalTest: true });
    await h.ready();
    h.google.receive({ serverContent: {
      inputTranscription: { text: 'guest question' }, outputTranscription: { text: 'restaurant answer' },
      turnComplete: true,
    } });
    expect(messages(h.twilio)).toEqual([
      { event: 'diagnostic', kind: 'ready' },
      { event: 'diagnostic', kind: 'input-transcript', text: 'guest question' },
      { event: 'diagnostic', kind: 'transcript', text: 'restaurant answer' },
      { event: 'diagnostic', kind: 'turn-complete' },
    ]);
  });

  it('never trusts a caller-supplied internalTest flag', async () => {
    const h = harness();
    h.twilio.receive(startMessage({ internalTest: true, customParameters: { token: TOKEN, internalTest: 'true' } }));
    await flush();
    h.google.receive({ setupComplete: {} });
    h.google.receive({ serverContent: { outputTranscription: { text: 'private' } } });
    expect(h.twilio.sent).toEqual([]);
  });

  it.each([
    ['transfer_to_team', 'handoff'], ['take_voicemail', 'voicemail'], ['end_call', 'end'],
  ])('routes %s through the authorized action broker exactly once', async (name, action) => {
    const h = harness({ internalTest: true });
    await h.ready();
    const toolCall = { functionCalls: [{ id: 'function-1', name, args: { phone: '+19999999999' } }] };
    h.google.receive({ toolCall });
    h.google.receive({ toolCall });
    await flush();
    const actions = h.fetcher.mock.calls.filter(([input]) => String(input).endsWith('/action'));
    expect(actions).toHaveLength(1);
    expect(JSON.parse(String(actions[0][1]?.body))).toEqual({ token: TOKEN, callSid: CALL, action });
    expect(messages(h.twilio)).toContainEqual({ event: 'diagnostic', kind: 'action', text: action });
    expect(h.twilio.closeCode).toBe(1000);
    expect(h.google.closeCode).toBe(1000);
  });

  it('lets immediate tool cancellation win before a handoff is submitted', async () => {
    const h = harness();
    await h.ready();
    h.google.receive({ toolCall: { functionCalls: [{ id: 'cancel-me', name: 'transfer_to_team' }] } });
    h.google.receive({ toolCallCancellation: { ids: ['cancel-me'] } });
    await flush();
    expect(h.fetcher.mock.calls.filter(([input]) => String(input).endsWith('/action'))).toHaveLength(0);
    expect(h.twilio.readyState).toBe(1);
  });

  it('waits for the spoken announcement mark before updating a call', async () => {
    const h = harness();
    await h.ready();
    h.google.receive({ serverContent: { modelTurn: { parts: [{
      inlineData: { mimeType: 'audio/pcm;rate=24000', data: OUTPUT_AUDIO },
    }] } } });
    h.google.receive({ toolCall: { functionCalls: [{ id: 'after-announcement', name: 'transfer_to_team' }] } });
    await flush();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(messages(h.twilio).at(-1)).toEqual({ event: 'mark', streamSid: STREAM, mark: { name: 'action-1' } });
    h.twilio.receive({ event: 'mark', streamSid: STREAM, mark: { name: 'action-1' } });
    await flush();
    expect(h.fetcher).toHaveBeenCalledTimes(3);
    expect(h.twilio.closeCode).toBe(1000);
  });

  it('cancels a pending spoken handoff when the caller interrupts it', async () => {
    const h = harness();
    await h.ready();
    h.google.receive({ serverContent: { modelTurn: { parts: [{
      inlineData: { mimeType: 'audio/pcm;rate=24000', data: OUTPUT_AUDIO },
    }] } } });
    h.google.receive({ toolCall: { functionCalls: [{ id: 'interrupt-me', name: 'transfer_to_team' }] } });
    await flush();
    h.google.receive({ serverContent: { interrupted: true } });
    h.twilio.receive({ event: 'mark', streamSid: STREAM, mark: { name: 'action-1' } });
    await flush();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.twilio.readyState).toBe(1);
    expect(messages(h.twilio).at(-1)).toEqual({ event: 'clear', streamSid: STREAM });
  });

  it('bounds announcement drain while keypad handoff bypasses the wait', async () => {
    const h = harness();
    await h.ready();
    h.google.receive({ serverContent: { modelTurn: { parts: [{
      inlineData: { mimeType: 'audio/pcm;rate=24000', data: OUTPUT_AUDIO },
    }] } } });
    h.google.receive({ toolCall: { functionCalls: [{ id: 'missing-mark', name: 'take_voicemail' }] } });
    await flush();
    await vi.advanceTimersByTimeAsync(2499);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.fetcher).toHaveBeenCalledTimes(3);
    const keypad = harness();
    await keypad.ready();
    keypad.google.receive({ serverContent: { modelTurn: { parts: [{
      inlineData: { mimeType: 'audio/pcm;rate=24000', data: OUTPUT_AUDIO },
    }] } } });
    keypad.twilio.receive({ event: 'dtmf', streamSid: STREAM, dtmf: { digit: '0' } });
    await flush();
    expect(keypad.fetcher).toHaveBeenCalledTimes(3);
  });

  it('rejects unsupported tool names, including inherited Object property names', async () => {
    const h = harness();
    await h.ready();
    h.google.receive({ toolCall: { functionCalls: [{ id: 'bad', name: '__proto__' }] } });
    await flush();
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(messages(h.google).at(-1)).toMatchObject({ toolResponse: { functionResponses: [{
      id: 'bad', response: { error: 'Unsupported action' },
    }] } });
  });

  it('lets keypad0 request the same trusted handoff route', async () => {
    const h = harness();
    await h.ready();
    h.twilio.receive({ event: 'dtmf', streamSid: STREAM, dtmf: { digit: '0' } });
    await flush();
    expect(JSON.parse(String(h.fetcher.mock.calls[2][1]?.body))).toEqual({ token: TOKEN, callSid: CALL, action: 'handoff' });
  });

  it('hands off on goAway without trying to override a fully locked token setup', async () => {
    const h = harness();
    await h.ready();
    h.google.receive({ goAway: { timeLeft: '30s' } });
    await flush();
    expect(h.google.readyState).toBe(3);
    expect(h.twilio.readyState).toBe(3);
    expect(messages(h.resumed)).toHaveLength(0);
    expect(JSON.parse(String(h.fetcher.mock.calls[2][1]?.body))).toEqual({ token: TOKEN, callSid: CALL, action: 'handoff' });
  });
});

describe('voice Live Worker failure containment', () => {
  it.each([
    { callSid: 'invalid' },
    { accountSid: 'invalid' },
    { customParameters: { token: 'x'.repeat(495) } },
    { mediaFormat: { encoding: 'audio/pcm', sampleRate: 8000, channels: 1 } },
  ])('rejects malformed start before any broker request: %j', async (invalid) => {
    const h = harness();
    h.twilio.receive(startMessage(invalid));
    await flush();
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.twilio.closeCode).toBe(1011);
  });

  it('rejects broker authentication failure and CallSid mismatch without disclosing details', async () => {
    const denied = harness({ sessionStatus: 403, sessionBody: { error: 'sensitive upstream explanation' } });
    denied.twilio.receive(startMessage());
    await flush();
    expect(denied.twilio.closeCode).toBe(1011);
    expect(denied.twilio.closeReason).toBe('broker_http_403');
    expect(denied.twilio.sent).toEqual([]);
    const mismatched = harness({ sessionBody: { ...session(), callSid: `CA${'4'.repeat(32)}` } });
    mismatched.twilio.receive(startMessage());
    await flush();
    expect(mismatched.fetcher).toHaveBeenCalledTimes(1);
    expect(mismatched.twilio.closeCode).toBe(1011);
  });

  it.each([
    { url: 'https://attacker.example/steal' },
    { url: `${GOOGLE_URL}?key=master` },
    { headers: { 'x-goog-api-key': 'master-key' } },
    { headers: { Authorization: 'Bearer master-key' } },
  ])('rejects unsafe upstream configuration: %j', async (change) => {
    const body = session();
    const h = harness({ sessionBody: { ...body, gemini: { ...body.gemini, ...change } } });
    h.twilio.receive(startMessage());
    await flush();
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(h.twilio.closeCode).toBe(1011);
  });

  it('bounds unauthenticated start, broker requests and upstream setup waits', async () => {
    const idle = harness();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(idle.twilio.closeCode).toBe(1011);
    const pending = harness({ sessionResponse: new Promise(() => {}) });
    pending.twilio.receive(startMessage());
    await vi.advanceTimersByTimeAsync(4_000);
    expect(pending.twilio.closeCode).toBe(1011);
    const noSetup = harness();
    noSetup.twilio.receive(startMessage());
    await flush();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(noSetup.twilio.closeCode).toBe(1011);
    expect(noSetup.google.closeCode).toBe(1011);
  });

  it('bounds pending media and refuses audio bound to another stream', async () => {
    const pending = harness({ sessionResponse: new Promise(() => {}) });
    pending.twilio.receive(startMessage());
    for (let index = 0; index < 500; index += 1) pending.twilio.receive(mediaMessage());
    expect(pending.twilio.closeCode).toBe(1011);
    const other = harness();
    await other.ready();
    other.twilio.receive(mediaMessage(INPUT_AUDIO, `MZ${'9'.repeat(32)}`));
    expect(other.twilio.closeCode).toBe(1011);
  });

  it('closes both peers on upstream failure, malformed messages and caller stop', async () => {
    const broken = harness();
    await broken.ready();
    broken.google.receive('not-json');
    expect(broken.twilio.closeCode).toBe(1011);
    expect(broken.google.closeCode).toBe(1011);
    const stopped = harness();
    await stopped.ready();
    stopped.twilio.receive({ event: 'stop', streamSid: STREAM });
    expect(stopped.twilio.closeCode).toBe(1000);
    expect(stopped.google.closeCode).toBe(1000);
  });

  it('hands off before nine minutes and bounds the action request deadline', async () => {
    const long = harness();
    await long.ready();
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(long.twilio.closeCode).toBe(1000);
    expect(JSON.parse(String(long.fetcher.mock.calls[2][1]?.body))).toEqual({ token: TOKEN, callSid: CALL, action: 'handoff' });
    const action = harness({ actionResponse: new Promise(() => {}) });
    await action.ready();
    action.google.receive({ toolCall: { functionCalls: [{ id: 'slow', name: 'take_voicemail' }] } });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(action.twilio.closeCode).toBe(1011);
    expect(action.google.closeCode).toBe(1011);
  });

  it('rejects oversized frames and wrong-rate output instead of playing corrupted audio', async () => {
    const oversized = harness();
    oversized.twilio.receive('x'.repeat(16_001));
    expect(oversized.twilio.closeCode).toBe(1011);
    const wrongRate = harness();
    await wrongRate.ready();
    wrongRate.google.receive({ serverContent: { modelTurn: { parts: [{
      inlineData: { mimeType: 'audio/pcm;rate=16000', data: OUTPUT_AUDIO },
    }] } } });
    expect(wrongRate.twilio.closeCode).toBe(1011);
    expect(wrongRate.twilio.sent).toHaveLength(0);
  });
});
