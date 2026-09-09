# Le Yard call receptionist

The Phone deployment answers the existing Twilio number using Twilio speech recognition, Gemini 3.1 Flash Lite for grounded replies, and the selected Fish Official Hannah voice. `docs/le-yard-receptionist.md` is loaded into the runtime system instruction; edit it when approved opening facts change. It is a knowledge and personality file, not model fine tuning.

## Caller experience

The AI introduces itself once, answers ordinary restaurant questions, and offers the team or voicemail where needed. Caller speech or a keypress can interrupt the prompt because playback is nested inside an interruptible Twilio Gather. Speech uses the phone-call recognizer with one second of end-of-speech silence. This HTTP turn implementation waits for a completed utterance before generating an answer; it does not proactively speak over a caller mid-utterance.

Pressing zero or requesting a person reaches the existing simultaneous founder ring group with press-one screening. The first founder to accept gets the call. Existing no-answer handling remains in place. An explicit voicemail choice goes to the existing recording path. Two silent turns end politely; repeated model failures offer voicemail. Fish errors use intelligible Twilio speech. Provider timeouts are bounded beneath Twilio's callback deadline.

The original room-tone track combines quiet wordless crowd texture, glass/cutlery sounds, and a gentle original café waltz. It is mixed below speech with ducking and short fades. The background ends at the listening boundary and on transfer. It represents ambience, not a recording of a currently open dining room.

Bookings, cancellation, payment, unsolicited texts, and emails are not available as voice actions in this release. The restaurant's approved status is preopening, so the receptionist does not announce bookable tables or confirmed opening hours. Inquiry details can be left through voicemail or discussed with a founder.

## Runtime and recovery

- `TWILIO_INBOUND_MODE=fish-gemini` activates the AI. `human` restores the existing greeting and simultaneous founder ringing on the next deployment.
- `GEMINI_API_KEY` supplies reasoning; `FISH_API_KEY` and optional `FISH_VOICE_MODEL` supply Hannah TTS. No new ElevenLabs dependency or funded voice model was added.
- `VOICE_AI_STATE_SECRET` is a separate random secret of at least 32 characters. AES-GCM state is bound to the call identifier, expires after twenty minutes without renewal, and keeps only bounded recent turns. No plaintext transcripts appear in callback URLs.
- The private Supabase `voice-reception` bucket allows WAV audio up to 3 MB. Keys contain a version, UTC date, and content hash. Signed playback URLs last ten minutes. URL expiry does not delete objects; the dated cache folders can be removed through the Storage API when past the desired retention window. Never make this bucket public or grant anonymous listing.
- Telemetry records call identifier, turn, action, provider/fallback, and latency; it does not log speech, prompts, credentials, or signed audio URLs.
- The greeting is a generated static WAV at `/audio/le-yard-ai-welcome.wav`. Runtime tracing includes the personality file and original ambience. Other audio and staff calling routes keep their authentication boundaries.

## Internal verification

Run the focused unit suites for voice AI, voice routes, Fish, existing incoming/screening/voicemail, and callback safety. The opt-in `vitest.voice-provider.config.mts` suite exercises actual Gemini/Fish/private audio storage directly. Protected environment values must be supplied without printing them.

`scripts/verify-voice-reception.mjs` exercises the deployed incoming and turn webhooks with Twilio signatures. The signed initial request contains a fresh internal-test marker, which becomes authenticated encrypted session state. Such sessions never emit Dial, Record, redirect, or guest events, even when the model requests handoff. The script has no Twilio Calls or Messages API calls. It verifies actual Fish playback URLs, conversational turns, isolated handoff/voicemail, silence handling, and unsigned-request rejection, then writes an evidence report and sample audio under ignored `output/voice-reception`.

These checks establish software, model, speech synthesis, storage, and deployed callback behavior. Physical telephone recognition, carrier audio quality, real barge-in timing, and founder bridging require the owners' handset rehearsal. No owner or guest calls are placed by the internal checks.

## Provider references

- [Twilio Gather](https://www.twilio.com/docs/voice/twiml/gather) and [official SDK Gather attributes](https://raw.githubusercontent.com/twilio/twilio-node/main/src/twiml/VoiceResponse.ts)
- [Fish TTS API](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech)
