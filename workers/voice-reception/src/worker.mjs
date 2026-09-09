import { createAudioCodec } from './audio.mjs';

const APP_ORIGIN = 'https://phone.leyardny.com';
const START_TIMEOUT_MS = 5_000;
const SETUP_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 4_000;
// Tokens lock the full setup. Finish before Google's ~10-minute socket lifetime
// instead of attempting to override a locked sessionResumption.handle.
const MAX_CALL_MS = 9 * 60_000;
const MAX_PENDING_AUDIO = 96_000;
const MAX_JSON_BYTES = 96_000;
const ACTIONS = Object.freeze({
  transfer_to_team: 'handoff',
  take_voicemail: 'voicemail',
  end_call: 'end',
});
const GREETING = 'Thanks for calling Le Yard. How can I help?';

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function frame(data, maxBytes) {
  let text;
  if (typeof data === 'string') {
    if (data.length > maxBytes) throw new Error('frame_size');
    text = data;
  } else if (data instanceof ArrayBuffer) {
    if (data.byteLength > maxBytes) throw new Error('frame_size');
    text = new TextDecoder().decode(data);
  } else {
    throw new Error('frame_type');
  }
  const value = JSON.parse(text);
  if (!record(value)) throw new Error('frame_shape');
  return value;
}

function closeSocket(socket, code = 1000, reason = 'session_ended') {
  try {
    if (socket && socket.readyState < 2) socket.close(code, reason);
  } catch {
    // Closing a disconnected peer is harmless; provider details stay private.
  }
}

async function boundedJson(response) {
  if (!response.ok) {
    const category = [301, 302, 307, 308, 400, 401, 403, 404, 429, 500, 502, 503, 504].includes(response.status)
      ? `broker_http_${response.status}` : 'broker_response';
    throw new Error(category);
  }
  if (!response.body) throw new Error('broker_response');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) throw new Error('broker_size');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  if (!record(parsed)) throw new Error('broker_shape');
  return parsed;
}

function upstreamConfig(value) {
  if (!record(value) || typeof value.url !== 'string' || !record(value.headers)) {
    throw new Error('upstream_config');
  }
  const url = new URL(value.url);
  if (!['https:', 'wss:'].includes(url.protocol)
    || url.hostname !== 'generativelanguage.googleapis.com'
    || url.port || url.username || url.password || url.search || url.hash
    || !/^\/ws\/google\.ai\.generativelanguage\.v1(?:beta|alpha)\.GenerativeService\.BidiGenerateContentConstrained$/.test(url.pathname)) {
    throw new Error('upstream_origin');
  }
  // The bridge only receives a one-session token, never a master API key.
  const suppliedHeaders = new Headers(value.headers);
  const authorization = suppliedHeaders.get('authorization');
  if (!authorization || !/^Token auth_tokens\/[^\s]{1,8192}$/.test(authorization)) {
    throw new Error('upstream_auth');
  }
  const setup = record(value.setup?.setup) ? value.setup.setup : value.setup;
  if (!record(setup) || typeof setup.model !== 'string'
    || !/^models\/gemini-(?:3\.1-flash-live-preview|2\.5-flash-native-audio-preview-12-2025)$/.test(setup.model)) {
    throw new Error('upstream_setup');
  }
  url.protocol = 'https:';
  return { url: url.href, headers: { Upgrade: 'websocket', Authorization: authorization }, setup };
}

function failureCategory(error, fallback) {
  const categories = new Set(['start_shape', 'input_format', 'duplicate_start', 'frame_size', 'frame_type',
    'frame_shape', 'broker_response', 'broker_size', 'broker_shape', 'session_binding', 'request_timeout',
    'upstream_config', 'upstream_origin', 'upstream_auth', 'upstream_setup', 'upstream_upgrade',
    'broker_fetch_failed', 'broker_decode_failed', 'upstream_fetch_failed',
    'broker_redirect_error', 'broker_request_context', 'broker_illegal_invocation', 'broker_tls_error',
    'broker_network_error', 'broker_type_error', 'broker_abort_error',
    'broker_http_301', 'broker_http_302', 'broker_http_307', 'broker_http_308',
    'broker_http_400', 'broker_http_401', 'broker_http_403', 'broker_http_404', 'broker_http_429',
    'broker_http_500', 'broker_http_502', 'broker_http_503', 'broker_http_504']);
  return categories.has(error?.message) ? error.message : fallback;
}

function brokerTransportCategory(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (/redirect/i.test(message)) return 'broker_redirect_error';
  if (/illegal invocation/i.test(message)) return 'broker_illegal_invocation';
  if (/request context|different request|global scope|outside.*handler|I\/O.*(?:request|context)/i.test(message)) return 'broker_request_context';
  if (/TLS|SSL|certificate/i.test(message)) return 'broker_tls_error';
  if (/DNS|resolve|network|fetch failed/i.test(message)) return 'broker_network_error';
  if (error?.name === 'TypeError') return 'broker_type_error';
  if (error?.name === 'AbortError') return 'broker_abort_error';
  return 'broker_fetch_failed';
}

/** One call owns all mutable state. The exported bridge also supports offline protocol tests. */
export function createVoiceBridge(twilio, request, env = {}, fetchImpl = (input, init) => globalThis.fetch(input, init)) {
  const origin = new URL(env.VOICE_APP_ORIGIN || APP_ORIGIN);
  if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('app_origin');
  const codec = createAudioCodec();
  const controllers = new Set();
  const cancelledTools = new Set();
  const seenTools = new Set();
  const playbackMarks = new Map();
  const playbackWaiters = new Set();
  let closed = false;
  let started = false;
  let ready = false;
  let internalTest = false;
  let callSid = '';
  let streamSid = '';
  let token = '';
  let upstream;
  let upstreamSocket;
  let pendingAudio = [];
  let pendingBytes = 0;
  let setupTimer;
  let actionInFlight = false;
  let pendingActionToolId;
  let turnNumber = 0;
  let outputInTurn = false;
  let mediaSequence = 0;
  let drainedSequence = 0;
  let actionMarkSequence = 0;
  const startTimer = setTimeout(() => fail('start_timeout'), START_TIMEOUT_MS);
  const callTimer = setTimeout(() => {
    if (ready) void runAction('handoff').catch(() => fail('call_limit'));
    else fail('call_limit');
  }, MAX_CALL_MS);

  function send(socket, payload) {
    if (closed || !socket || socket.readyState !== 1) throw new Error('socket_closed');
    if (typeof socket.bufferedAmount === 'number' && socket.bufferedAmount > 512_000) {
      throw new Error('socket_backpressure');
    }
    socket.send(JSON.stringify(payload));
  }

  function diagnostic(kind, text) {
    if (!internalTest || closed) return;
    try {
      send(twilio, { event: 'diagnostic', kind, ...(typeof text === 'string' ? { text: text.slice(0, 4000) } : {}) });
    } catch {
      // Diagnostics never keep a failed call alive.
    }
  }

  function close(code = 1000, reason = 'session_ended') {
    if (closed) return;
    closed = true;
    ready = false;
    clearTimeout(startTimer);
    clearTimeout(setupTimer);
    clearTimeout(callTimer);
    for (const controller of controllers) controller.abort();
    controllers.clear();
    closeSocket(upstreamSocket, code, reason);
    closeSocket(twilio, code, reason);
    pendingAudio = [];
    playbackMarks.clear();
    for (const finish of [...playbackWaiters]) finish();
    token = '';
    upstream = undefined;
    codec.reset();
  }

  function fail(reason) {
    // Only fixed internal error categories are observable, never provider exceptions.
    diagnostic('error', reason);
    close(1011, reason);
  }

  async function deadline(operation) {
    const controller = new AbortController();
    controllers.add(controller);
    let timer;
    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('request_timeout'));
          }, REQUEST_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }

  async function broker(path, body) {
    return deadline(async (signal) => {
      let response;
      try {
        response = await fetchImpl(new URL(path, origin.origin).href, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), redirect: 'manual', signal,
        });
      } catch (error) { throw new Error(brokerTransportCategory(error)); }
      try { return await boundedJson(response); }
      catch (error) { throw new Error(failureCategory(error, 'broker_decode_failed')); }
    });
  }

  function sendInput(payload) {
    send(upstreamSocket, { realtimeInput: { audio: {
      mimeType: 'audio/pcm;rate=16000', data: codec.mulawToPcm16k(payload),
    } } });
  }

  function clearPlayback() {
    codec.resetOutput();
    outputInTurn = false;
    turnNumber += 1;
    if (pendingActionToolId) cancelledTools.add(pendingActionToolId);
    drainedSequence = mediaSequence;
    playbackMarks.clear();
    for (const finish of [...playbackWaiters]) finish();
    send(twilio, { event: 'clear', streamSid });
    diagnostic('interrupted');
  }

  function markPlayback(name) {
    if (playbackMarks.size >= 128) throw new Error('playback_mark_limit');
    playbackMarks.set(name, mediaSequence);
    send(twilio, { event: 'mark', streamSid, mark: { name } });
  }

  function waitForAnnouncement() {
    if (closed || drainedSequence >= mediaSequence) return Promise.resolve();
    return new Promise((resolve) => {
      const targetSequence = mediaSequence;
      let timer;
      const finish = () => {
        clearTimeout(timer);
        playbackWaiters.delete(finish);
        resolve();
      };
      // Only genuine mark acknowledgements drain audio; clear cancels the pending
      // tool instead. The cap prevents a missing acknowledgement stranding callers.
      finish.targetSequence = targetSequence;
      playbackWaiters.add(finish);
      timer = setTimeout(finish, 2500);
      try { markPlayback(`action-${++actionMarkSequence}`); }
      catch { finish(); }
    });
  }

  async function runAction(action, tool) {
    if (closed || actionInFlight) return;
    actionInFlight = true;
    pendingActionToolId = tool?.id;
    // A cancellation already queued in the same upstream event wins before side effects.
    await Promise.resolve();
    if (tool && !cancelledTools.has(tool.id) && !closed) await waitForAnnouncement();
    if (closed || (tool && cancelledTools.has(tool.id))) {
      actionInFlight = false;
      pendingActionToolId = undefined;
      return;
    }
    const result = await broker('/api/twilio/voice/live/action', { token, callSid, action });
    if (closed) return;
    if (result.ok === false) throw new Error('action_rejected');
    diagnostic('action', action);
    if (tool && !cancelledTools.has(tool.id) && upstreamSocket?.readyState === 1) {
      send(upstreamSocket, { toolResponse: { functionResponses: [{
        id: tool.id, name: tool.name, response: { ok: true },
      }] } });
    }
    // Next has updated the existing call (or suppressed the action for an internal test).
    close();
  }

  function onToolCalls(calls) {
    if (!Array.isArray(calls) || calls.length > 8) throw new Error('tool_shape');
    for (const tool of calls) {
      if (!record(tool) || typeof tool.id !== 'string' || tool.id.length > 200
        || typeof tool.name !== 'string' || tool.name.length > 100) throw new Error('tool_shape');
      if (seenTools.has(tool.id) || cancelledTools.has(tool.id)) continue;
      if (seenTools.size >= 32) throw new Error('tool_limit');
      seenTools.add(tool.id);
      const action = Object.hasOwn(ACTIONS, tool.name) ? ACTIONS[tool.name] : undefined;
      if (!action) {
        send(upstreamSocket, { toolResponse: { functionResponses: [{
          id: tool.id, name: tool.name, response: { error: 'Unsupported action' },
        }] } });
      } else {
        void runAction(action, tool).catch(() => fail('action_failed'));
      }
    }
  }

  function onGemini(message, socket) {
    if (closed || socket !== upstreamSocket) return;
    if (message.error) throw new Error('upstream_error');
    if (record(message.setupComplete)) {
      if (ready) return;
      clearTimeout(setupTimer);
      ready = true;
      diagnostic('ready');
      send(socket, { realtimeInput: { text: `A caller has just connected. Say exactly: ${GREETING} Then listen.` } });
      for (const payload of pendingAudio) sendInput(payload);
      pendingAudio = [];
      pendingBytes = 0;
    }
    const cancellations = message.toolCallCancellation?.ids;
    if (Array.isArray(cancellations)) {
      if (cancellations.length > 32 || cancelledTools.size > 64) throw new Error('tool_limit');
      for (const id of cancellations) if (typeof id === 'string') cancelledTools.add(id);
    }
    const content = message.serverContent;
    if (record(content)) {
      if (content.interrupted) clearPlayback();
      if (typeof content.inputTranscription?.text === 'string') diagnostic('input-transcript', content.inputTranscription.text);
      if (typeof content.outputTranscription?.text === 'string') diagnostic('transcript', content.outputTranscription.text);
      // Interrupted content belongs to the discarded generation, including co-located parts.
      if (!content.interrupted && ready && Array.isArray(content.modelTurn?.parts)) {
        for (const part of content.modelTurn.parts) {
          if (!part.inlineData) continue;
          if (!/^audio\/pcm(?:;\s*rate=24000)?$/.test(part.inlineData.mimeType || '')) throw new Error('audio_format');
          const payload = codec.pcm24kToMulaw(part.inlineData.data);
          if (!payload) continue;
          send(twilio, { event: 'media', streamSid, media: { payload } });
          mediaSequence += 1;
          outputInTurn = true;
        }
      }
      if (content.turnComplete) {
        if (outputInTurn) markPlayback(`turn-${turnNumber}`);
        outputInTurn = false;
        turnNumber += 1;
        diagnostic('turn-complete');
      }
    }
    if (message.toolCall) onToolCalls(message.toolCall.functionCalls);
    if (message.goAway && !actionInFlight) {
      void runAction('handoff').catch(() => fail('session_expired'));
    }
  }

  async function connectUpstream() {
    if (closed || !upstream) return;
    ready = false;
    const oldSocket = upstreamSocket;
    upstreamSocket = undefined;
    closeSocket(oldSocket);
    clearTimeout(setupTimer);
    setupTimer = setTimeout(() => fail('setup_timeout'), SETUP_TIMEOUT_MS);
    const response = await deadline(async (signal) => {
      try { return await fetchImpl(upstream.url, { headers: upstream.headers, redirect: 'manual', signal }); }
      catch { throw new Error('upstream_fetch_failed'); }
    });
    if (closed) {
      closeSocket(response.webSocket);
      return;
    }
    if (response.status !== 101 || !response.webSocket) throw new Error('upstream_upgrade');
    const socket = response.webSocket;
    upstreamSocket = socket;
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', (event) => {
      try { onGemini(frame(event.data, 128_000), socket); }
      catch (error) { fail(failureCategory(error, 'upstream_message')); }
    });
    socket.addEventListener('close', () => {
      if (socket === upstreamSocket && !closed) fail('upstream_closed');
    });
    socket.addEventListener('error', () => {
      if (socket === upstreamSocket && !closed) fail('upstream_connection');
    });
    socket.accept();
    send(socket, { setup: upstream.setup });
  }

  async function start(message) {
    if (started) throw new Error('duplicate_start');
    started = true;
    clearTimeout(startTimer);
    const data = message.start;
    if (!record(data) || !/^CA[0-9a-f]{32}$/i.test(data.callSid)
      || !/^AC[0-9a-f]{32}$/i.test(data.accountSid)
      || !/^MZ[0-9a-f]{32}$/i.test(data.streamSid || message.streamSid)
      || typeof data.customParameters?.token !== 'string'
      || data.customParameters.token.length < 20 || data.customParameters.token.length >= 495) {
      throw new Error('start_shape');
    }
    const format = data.mediaFormat;
    if (format && (format.encoding !== 'audio/x-mulaw' || format.sampleRate !== 8000 || format.channels !== 1)) {
      throw new Error('input_format');
    }
    callSid = data.callSid;
    streamSid = data.streamSid || message.streamSid;
    token = data.customParameters.token;
    const session = await broker('/api/twilio/voice/live/session', {
      token, callSid, accountSid: data.accountSid,
      streamUrl: request.url,
      twilioSignature: (request.headers.get('x-twilio-signature') || '').slice(0, 512),
    });
    if (closed) return;
    if (session.callSid !== callSid || typeof session.internalTest !== 'boolean') throw new Error('session_binding');
    upstream = upstreamConfig(session.gemini);
    internalTest = session.internalTest;
    await connectUpstream();
  }

  twilio.binaryType = 'arraybuffer';
  twilio.addEventListener('message', (event) => {
    if (closed) return;
    try {
      const message = frame(event.data, 16_000);
      if (message.event === 'start') {
        void start(message).catch((error) => fail(failureCategory(error, 'session_failed')));
      } else if (message.event === 'media') {
        if (!started || !streamSid || message.streamSid !== streamSid) throw new Error('media_binding');
        const payload = message.media?.payload;
        if (typeof payload !== 'string' || payload.length === 0 || payload.length > 4096
          || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) throw new Error('media_shape');
        if (message.media.track && message.media.track !== 'inbound') return;
        if (ready) sendInput(payload);
        else {
          pendingBytes += payload.length;
          if (pendingBytes > MAX_PENDING_AUDIO) throw new Error('input_backpressure');
          pendingAudio.push(payload);
        }
      } else if (message.event === 'stop') {
        close();
      } else if (message.event === 'mark') {
        if (message.streamSid !== streamSid) throw new Error('mark_binding');
        const name = message.mark?.name;
        if (typeof name === 'string' && playbackMarks.has(name)) {
          drainedSequence = Math.max(drainedSequence, playbackMarks.get(name));
          playbackMarks.delete(name);
          for (const finish of [...playbackWaiters]) if (finish.targetSequence <= drainedSequence) finish();
        }
      } else if (message.event === 'dtmf' && message.dtmf?.digit === '0' && ready) {
        if (message.streamSid !== streamSid) throw new Error('dtmf_binding');
        void runAction('handoff').catch(() => fail('action_failed'));
      }
    } catch (error) {
      fail(failureCategory(error, 'caller_message'));
    }
  });
  twilio.addEventListener('close', () => close());
  twilio.addEventListener('error', () => fail('caller_connection'));
  twilio.accept();
  return { close };
}

function streamRequestError(request) {
  const url = new URL(request.url);
  if (url.pathname !== '/stream') return new Response('Not found', { status: 404 });
  if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('WebSocket required', { status: 426 });
  }
  if (url.search || url.hash) return new Response('Invalid stream URL', { status: 400 });
  return null;
}

// Fetch-only Durable Object: each accepted call owns one isolated bridge. The
// outgoing Gemini socket keeps it active; no hibernation or stored audio/state.
// Unlike a Free Worker request, incoming messages refresh the DO CPU budget.
export class VoiceReceptionSessionDO {
  constructor(_ctx, env) {
    this.env = env;
    this.sessionStarted = false;
  }

  async fetch(request) {
    const invalid = streamRequestError(request);
    if (invalid) return invalid;
    if (this.sessionStarted) return new Response('Session already started', { status: 409 });
    this.sessionStarted = true;
    const pair = new WebSocketPair();
    try {
      createVoiceBridge(pair[1], request, this.env);
      return new Response(null, { status: 101, webSocket: pair[0] });
    } catch {
      closeSocket(pair[1], 1011);
      return new Response('Voice unavailable', { status: 503 });
    }
  }
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ status: 'up', version: 'streaming-native-v1' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const invalid = streamRequestError(request);
    if (invalid) return invalid;
    try {
      if (!env?.VOICE_SESSIONS) throw new Error('session_binding_missing');
      // Never share an object across unrelated calls. Forward the original
      // request so the provider's exact upgrade URL and signature survive.
      const id = env.VOICE_SESSIONS.newUniqueId();
      return await env.VOICE_SESSIONS.get(id).fetch(request);
    } catch {
      // No inline Worker fallback: it would restore the unsafe Free CPU limit.
      return new Response('Voice unavailable', { status: 503 });
    }
  },
};

export default worker;
