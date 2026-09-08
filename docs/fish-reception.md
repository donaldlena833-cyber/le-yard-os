# Le Yard reception recording

The inbound Twilio route plays a reusable recording before its existing founder ring group when `TWILIO_RECEPTION_AUDIO_URL` is set. The production Phone project uses `https://phone.leyardny.com/audio/le-yard-reception.mp3`. Clearing that variable restores the Polly Joanna greeting on the next deployment.

The recording says: “Thank you for calling Le Yard. One moment while we connect you with our team.” It was generated using Fish Official's AI-designed Hannah voice (`9a9cf47702da476aa4629e2506d4a857`) and the `s2.1-pro-free` model. API pricing and availability may change; no paid-model fallback or recharge is enabled by this integration.

To regenerate from this checkout, privately configure `FISH_API_KEY` in the Git-ignored, owner-only `.env.fish.local` file, then run:

```sh
node --env-file=.env.fish.local scripts/generate-fish-reception-audio.mjs
```

Optional overrides: `FISH_MODEL`, `FISH_REFERENCE_ID`, `FISH_RECEPTION_TEXT`, and `FISH_RECEPTION_OUTPUT`. Review a new recording before deploying it. The current local API key is named **Le Yard Reception** and expires December 6, 2026. Expiration does not interrupt the deployed recording: calls play the MP3 and make no Fish API requests.

Only the exact recording path bypasses the app's session proxy. Other audio paths and outbound staff-call APIs retain the existing authentication handling. Neither the Fish API key nor personal forwarding numbers belong in this document, the public directory, or Git.

References: [Fish pricing](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits), [Fish API](https://docs.fish.audio/developer-guide/getting-started/quickstart).
