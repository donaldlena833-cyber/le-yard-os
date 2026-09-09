# Le Yard live voice receptionist

Implementation runbook, September 9, 2026. This describes the replacement for the earlier Fish/Gemini HTTP turn flow. Deployment evidence and handset acceptance must be recorded separately; code and provider probes do not establish how the replacement sounds on a real call.

## Architecture and caller experience

`TWILIO_INBOUND_MODE=gemini-live` makes the existing signed Twilio incoming webhook return a bidirectional `<Connect><Stream>`. The Cloudflare Worker bridges that stream to Gemini native audio. Gemini hears the audio directly and generates spoken audio directly; Fish synthesis and Twilio's completed-utterance `<Gather>` recognition are not on this active path.

Each upgrade is delegated through `VOICE_SESSIONS` to a new `VoiceReceptionSessionDO`, so a call owns its bridge and codec state. Standard accepted WebSockets keep the object active; no audio or conversation state is written to storage, and no hibernation is attempted while the outgoing Gemini connection is active. Incoming WebSocket messages refresh the Durable Object's CPU budget, avoiding the regular Free Worker's small aggregate request budget. SQLite-backed objects are available on Free; the configuration uses `new_sqlite_classes` migration `voice-session-v1` and leaves `limits.cpu_ms` unset. See [Cloudflare's Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/) and [standard WebSocket behavior](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

The native setup uses `gemini-3.1-flash-live-preview`, the Aoede voice, automatic activity detection with 200 ms prefix padding and 500 ms end-of-speech silence, and interruption on new caller activity. These are configured thresholds, not measured handset response times. The Worker triggers a short Le Yard greeting after setup and sends queued caller audio. The active greeting trigger lives in `workers/voice-reception/src/worker.mjs`; keep it consistent with the opening guidance in `docs/le-yard-receptionist-live.md`.

The runtime prompt is the compact `docs/le-yard-receptionist-live.md`, derived from the canonical `docs/le-yard-receptionist.md`. It favors brief, natural hosting and targeted clarification without an unsolicited AI introduction. It requires an honest answer if the caller asks whether the receptionist is AI. Both retain the restaurant's approved preopening facts. Editing a Markdown prompt changes instructions, not model weights.

Twilio audio is mono 8 kHz G.711 mu-law. A per-call codec converts it to 16 kHz PCM for Gemini with continuous interpolation. Gemini's 24 kHz PCM output passes through a 63-tap low-pass FIR and 3:1 decimation before mu-law encoding. State persists across audio chunks, including split PCM samples. On interruption, the Worker resets the outbound codec and sends Twilio `clear` to discard buffered playback. The FIR adds about 1.3 ms of filter delay.

The native bridge sends speech audio without the earlier Fish room-tone mix. Do not describe French music or restaurant ambience as active unless a later implementation actually mixes and verifies it. Prior recorded assets remain available for the legacy fallback path.

## Session and action boundaries

1. The incoming route validates the Twilio signature, shared business destination, and CallSid. It creates a short AES-GCM capability bound to that call, with a nonrenewing twenty-minute expiry.
2. The Worker receives the capability as a Twilio Stream custom parameter; parameter name plus value stays below 500 characters. No plaintext transcript travels in this capability.
3. `/api/twilio/voice/live/session` verifies the capability, configured account, exact stream URL, and Twilio's WebSocket upgrade signature. Only an authenticated internal-test capability may omit the provider signature.
4. The Phone server mints a single-use Gemini ephemeral token. It permits starting a session for one minute and expires after twenty minutes. The full model, voice, prompt, activity settings, and tool setup are locked into the token and reused unchanged for the constrained WebSocket. The Gemini master API key stays on the Phone server.
5. Gemini can request only team handoff, voicemail, or call end. No destination argument is accepted. The action route verifies the capability and checks that the provider call is still inbound, in progress, and addressed to the shared Le Yard number before updating that existing call.

Team handoff uses the existing two-founder simultaneous ring group with press-one screening. The first founder to accept takes the call. Voicemail uses the existing recording route. The runtime has no booking, cancellation, payment, email, or SMS action. It must not claim any such action succeeded.

Spoken tool actions wait for Twilio to acknowledge queued announcement playback, bounded to 2.5 seconds. An interruption cancels a pending spoken action before submission. Pressing zero transfers immediately.

The Worker hands the call to the team at nine minutes, before the provider socket's approximately ten-minute lifetime. A provider `goAway` also requests handoff. This version deliberately does not attempt session resumption with a modified setup because the ephemeral token locks its original setup. The capability is still valid at the nine-minute transition.

If the media stream closes unexpectedly, the original TwiML continues to a signed fallback route carrying the same call capability. The fallback attempts the configured team handoff. Internal capabilities instead produce a hangup, never a founder dial or voicemail recording. A failed internal diagnostic must not fall through to the normal live ring group.

## Configuration and production packaging

Phone server configuration:

| Setting | Purpose |
| --- | --- |
| `TWILIO_INBOUND_MODE=gemini-live` | Selects the native streaming path. |
| `VOICE_LIVE_STREAM_URL=wss://le-yard-reception.donaldlena833.workers.dev/stream` | Exact configured Worker stream URL. No query, credentials, or alternate path. |
| `VOICE_AI_STATE_SECRET` | Private independent random secret, at least 32 characters, for call capabilities. Keep stable during active calls. |
| `GEMINI_API_KEY` | Private key used only by the server to obtain ephemeral sessions. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Existing account identity and webhook/upgrade signature verification. |
| `TWILIO_PUBLIC_BASE_URL` | Phone public origin used for callbacks. |
| Existing shared-number, forwarding, and Twilio REST credential settings | Preserve the established number and screened founder destinations. |

Worker configuration uses optional `VOICE_APP_ORIGIN`, defaulting to `https://phone.leyardny.com`, for the server session/action broker. The Worker does not need Gemini or Twilio master secrets. Its `/health` endpoint is a process availability check, not a successful model session or a carrier test.

Deploy the Worker audio module, bridge, Durable Object export, and `wrangler.jsonc` binding/migration together. A missing `VOICE_SESSIONS` binding returns unavailable instead of falling back to processing audio in a regular Worker. Deploy the Phone application with all three live routes and the updated incoming route. Keep `voice-live.server.ts` on the Node server runtime because it reads the Markdown prompt from disk. `next.config.ts` declares both receptionist documents in output tracing. Verify the completed production build's `voice/live/session/route.js.nft.json` includes `docs/le-yard-receptionist-live.md`; checking only that the source file exists locally is insufficient.

Only the exact live session, action, and fallback paths bypass browser-session authentication; their handlers enforce provider/capability authorization. Staff outbound-call routes retain their normal authentication. Do not widen the entire `/api/twilio` prefix.

## Internal checks and acceptance

Offline suites make no real provider calls:

```sh
npx vitest run tests/unit/voice-live-audio.test.ts tests/unit/voice-live-worker.test.ts tests/unit/voice-live-durable-object.test.ts tests/unit/voice-live-server.test.ts
```

They exercise codec vectors, chunk continuity and alias suppression; bridge setup, interruption, tools and failures; signatures, call binding, input limits, ephemeral setup, internal action suppression, and exact public routes. Run the normal typecheck, lint, and production build after implementation changes.

`scripts/probe-native-voice.mjs` is a direct Gemini native-audio greeting probe using privately supplied credentials. It makes provider requests and writes local audio, but creates no Twilio calls or messages. Its result tests native speech generation; it does not exercise a real caller's recognition or carrier path. `scripts/verify-voice-reception.mjs` targets the earlier Gather/Fish flow and is not proof of native-stream acceptance.

For a deployed synthetic bridge rehearsal, use a signed incoming request containing `InternalTest=true`, `VoiceEngine=live`, and a fresh timestamp. Carry the returned capability through the stream start and action requests. Verify that handoff, voicemail, end, connection failure, and the time limit remain suppressed before any Twilio call mutation or owner notification. Never remove the internal flag or substitute a real guest CallSid to make a diagnostic pass. Keep tokens, transcripts, private numbers, and provider credentials out of reports and logs.

The owners tested the earlier voice flow and reported poor latency, recognition, and voice quality. The streaming replacement still needs a handset retest. Check natural voice quality, recognition across accents, caller corrections, actual pause duration, interruption clearance, zero-key and spoken handoff, first-founder acceptance, and no-answer voicemail. Record measured results and the tested deployment; do not mark these complete from simulated audio or HTTP success alone.

## September 9 internal audio evidence

`scripts/probe-live-voice.mjs --run` uses signed internal capabilities and synthetic spoken audio at real-time telephone frame cadence. It creates no Twilio calls or messages. The deployed bridge passed these rehearsals before activation:

| Spoken scenario | First response audio after caller finished | Additional evidence |
| --- | --- | --- |
| Reservation for two tomorrow around seven | 1,285 ms | Correctly transcribed the request; no false booking confirmation. |
| Address question spoken over the greeting | 1,542 ms | Cleared queued greeting 203 ms after speech began; answered 858 Ninth Avenue. |
| Request to speak to Maris | 2,305 ms | Brief spoken handoff announcement; action endpoint confirmed `suppressed: true`. |

These are synthetic HTTP/WebSocket measurements, not handset or carrier latency. Greeting audio began 1.4–2.2 seconds after WebSocket opening in the first successful runs. Artifacts are under ignored `output/voice-live/`. A notification offer observed in the initial reservation answer led to an explicit prompt restriction before the final Phone release; repeat that scenario against the final release.

The deployed-host rehearsal caught Cloudflare rejecting `redirect: "error"` synchronously. Both Worker fetches use `"manual"` and reject non-success responses or non-101 WebSocket upgrades, so redirects are never followed. Preserve this regression check even though standard Node fetch supports `"error"`.

## Rollback

For immediate recovery, set `TWILIO_INBOUND_MODE=human` on the Phone production project and redeploy that application. Subsequent incoming calls use the established reception greeting and simultaneous screened founder ring group. Keep the phone number, Messaging Service, carrier registrations, and existing callback destinations intact.

`TWILIO_INBOUND_MODE=fish-gemini` selects the previous HTTP Gather/Gemini/Fish implementation for a deliberate comparison or fallback. It retains the earlier utterance recognition and synthesis delays that motivated this replacement; `human` is the simpler operational recovery path.

A mode change affects new incoming requests. Leave the Worker and capability secret available while existing streaming calls finish or hand off. Do not rotate the state secret or remove the live fallback route during active calls. After rollback, verify the deployed incoming TwiML and separately record whether an owner completed a real call test.
