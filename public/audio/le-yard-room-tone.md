# Le Yard room tone

`le-yard-room-tone.wav` is an original, procedurally synthesized 30-second café ambience loop. It contains a quiet original waltz with warm plucked chords and a faint reed timbre, ten overlapping wordless room textures, and occasional softened glass/cutlery taps. The room texture suggests distant conversation; it contains no words or recorded people.

- Format: mono, 16 kHz, 16-bit signed PCM WAV.
- Duration: exactly 30 seconds.
- RMS: -39.00 dBFS; peak: -28.58 dBFS.
- First and last samples: digital silence, with a 6 ms edge taper for clean playback boundaries.
- Rights/provenance: generated entirely from the repository script. No third-party song, sample, recording, paid API, or identifiable voice is included.

Regenerate deterministically from the project root:

```sh
node scripts/generate-restaurant-room-tone.mjs
```

Use a gain of 0.4–0.65 beneath receptionist speech and fade between turns. Speech must always remain foregrounded. Stop the bed on a human transfer or emergency handoff. Do not send the bed into caller speech recognition. This asset is decorative, not a recording of the actual Le Yard dining room.

An internal eight-second mixing preview is available at `output/reception-room-tone-preview.wav`. It uses the existing Fish greeting without regenerating or modifying that source file, places the new room tone at 0.65 gain, and contains no live call audio. The preview demonstrates balance only; it is not an end-to-end telephone test.
