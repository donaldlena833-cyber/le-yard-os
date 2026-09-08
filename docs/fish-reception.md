# Le Yard reception recording

The Phone production project plays `https://phone.leyardny.com/audio/le-yard-reception-v2.wav` before the existing parallel ring group. Donald selected the Hannah preview on September 7, 2026. The 5.55-second mix combines Fish Official Hannah with quiet jazz and restaurant conversations. The background ends with the greeting; the existing screened calls to both founders then proceed.

The script is: “Hey, thanks for calling Le Yard! Give us just a moment, and we'll connect you with the team.” The voice is Hannah (`9a9cf47702da476aa4629e2506d4a857`), generated with `s2.1-pro-free`, conversational delivery cues, speed 0.97, temperature 0.7, and top-p 0.7. A New York accent was requested through delivery direction; it is not a verified native New York voice. Fish custom Voice Design returned HTTP 402 because API funds are separate from website credits. Further custom voice work is deferred at the user's request.

The voice, music, and room recording were mixed separately. The voice target was -16 LUFS, music -31 LUFS, and room -34 LUFS, with up to 4 dB of background ducking during speech. The mix has a 250 ms lead-in, 450 ms tail, and short fades. The deployed WAV is mono, 8 kHz, G.711 mu-law, band-limited to 180–3400 Hz. A full-band master and decoded telephone preview were also produced. This prepares the file for the telephone channel; it does not certify a physical handset/carrier listening test.

## Audio sources and permissions

- Voice: Fish Official Hannah; generated through the user's Fish API account. No community voice or real-person clone was used.
- Music: [Velvet Tide by Freedom Motif](https://freesafemusic.com/tracks/velvet-tide/), a smooth jazz/bossa track. A short segment beginning at 28 seconds is mixed under the voice. The [Free Safe Music license](https://freesafemusic.com/usage/) permits commercial use and mixing in content and apps. It prohibits redistributing the raw track as a standalone music asset; only the finished greeting is published here.
- Room: [Small Restaurant Conversations](https://bigsoundbank.com/small-restaurant-conversations-s3542.html), Joseph SARDIN and Axeline T., CC0. A segment beginning at 44 seconds supplies an indoor restaurant texture. This is an illustrative recording from another restaurant, not a recording of Le Yard operating.

## Regeneration and rollback

Configure `FISH_API_KEY` privately in the Git-ignored, owner-only `.env.fish.local`, then run:

```sh
node --env-file=.env.fish.local scripts/generate-fish-reception-audio.mjs
```

This creates a dry voice take in ignored `output/reception-voice.wav`; it does not replace the deployed mix. Optional overrides are `FISH_MODEL`, `FISH_REFERENCE_ID`, `FISH_RECEPTION_TEXT`, `FISH_RECEPTION_DIRECTION`, `FISH_RECEPTION_FORMAT` (`wav` or `mp3`), and `FISH_RECEPTION_OUTPUT`. Mix a selected take with licensed backgrounds, check the exported telephone version, then publish a versioned file and update `TWILIO_RECEPTION_AUDIO_URL` on the **Phone** project with a new deployment.

The local API key is named **Le Yard Reception** and expires December 6, 2026. Expiration does not interrupt this recording: calls play a static file and make no Fish API requests. No paid fallback or automatic recharge is configured. Model pricing can change.

To restore the earlier dry Hannah greeting, set `TWILIO_RECEPTION_AUDIO_URL` to `https://phone.leyardny.com/audio/le-yard-reception.mp3` and redeploy Phone. Clearing the variable instead restores Polly Joanna. Both exact audio paths bypass the session proxy; other audio paths retain authentication handling. Keep credentials and forwarding numbers out of public files and Git.

Technical references: [Fish model guidance](https://docs.fish.audio/developer-guide/models-pricing/models-overview), [Fish pricing](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits), [Twilio Play formats and transcoding](https://www.twilio.com/docs/voice/twiml/play).
