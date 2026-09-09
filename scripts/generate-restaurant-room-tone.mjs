import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Original procedural sound design. No recordings, speech, samples, external
// music, credentials, network requests, or third-party audio dependencies.
// A seeded 30-second circular arrangement makes the delivered file repeatable.
const sampleRate = 16_000;
const duration = 30;
const count = sampleRate * duration;
const music = new Float64Array(count);
const room = new Float64Array(count);
const tableware = new Float64Array(count);
let seed = 0x1e9a4d;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 0x100000000;
};
const between = (a, b) => a + (b - a) * random();
const tau = Math.PI * 2;
const midi = (note) => 440 * 2 ** ((note - 69) / 12);
const at = (bus, start, i, value) => {
  bus[((start + i) % count + count) % count] += value;
};
const smooth = (v) => v * v * (3 - 2 * v);

// A warm plucked/soft-key timbre: rounded attack, subdued upper harmonics.
function pluck(note, startSeconds, gain, length = 1.9) {
  const start = Math.round(startSeconds * sampleRate);
  const frequency = midi(note);
  for (let i = 0; i < length * sampleRate; i++) {
    const t = i / sampleRate;
    const attack = Math.min(1, t / 0.012);
    const release = Math.max(0, Math.min(1, (length - t) / 0.12));
    const fundamental = Math.sin(tau * frequency * t);
    const overtone = 0.22 * Math.sin(tau * frequency * 2 * t) * Math.exp(-2 * t)
      + 0.065 * Math.sin(tau * frequency * 3.002 * t) * Math.exp(-3 * t);
    at(music, start, i, gain * attack * release * Math.exp(-2.3 * t) * (fundamental + overtone));
  }
}

// Original, deliberately non-melodic café waltz. Twelve bars at 72 bpm.
// The chord pattern is common harmonic vocabulary, not an existing song.
const beat = 5 / 6;
const chords = [
  [36, 52, 55, 59, 62], [36, 52, 55, 59, 62],
  [33, 48, 52, 55, 59], [33, 48, 52, 55, 59],
  [38, 53, 57, 60, 64], [38, 53, 57, 60, 64],
  [31, 53, 57, 59, 64], [31, 53, 57, 59, 64],
  [36, 52, 55, 59, 62], [33, 48, 52, 55, 59],
  [38, 53, 57, 60, 64], [31, 53, 57, 59, 64],
];
for (let bar = 0; bar < chords.length; bar++) {
  const chord = chords[bar];
  const time = bar * 3 * beat;
  pluck(chord[0] + 12, time, 0.48, 1.5);
  for (let pulse = 1; pulse < 3; pulse++) {
    for (let n = 1; n < chord.length; n++) {
      pluck(chord[n], time + pulse * beat + n * 0.016, 0.19 * (pulse === 2 ? 0.8 : 1), 1.7);
    }
  }
  // A barely audible reed-like pad supplies the French café suggestion.
  const start = Math.round(time * sampleRate);
  const length = 3 * beat + 0.25;
  for (let i = 0; i < length * sampleRate; i++) {
    const t = i / sampleRate;
    const env = smooth(Math.min(1, t / 0.48)) * smooth(Math.max(0, Math.min(1, (length - t) / 0.58)));
    let value = 0;
    for (const note of chord.slice(1, 4)) {
      const f = midi(note);
      value += Math.sin(tau * f * t + 0.008 * Math.sin(tau * 4.3 * t))
        + 0.20 * Math.sin(tau * 2 * f * t) + 0.035 * Math.sin(tau * 3 * f * t);
    }
    at(music, start, i, value * env * 0.013);
  }
}

// Ten distant, overlapping *wordless* formant textures. Syllabic envelopes
// suggest a room occupied by diners, without any intelligible or recorded voice.
for (let speaker = 0; speaker < 10; speaker++) {
  let cursor = between(-2, 1);
  const basePitch = between(105, 220);
  while (cursor < duration) {
    const length = between(0.8, 2.5);
    const start = Math.round(cursor * sampleRate);
    const pace = between(2.8, 4.8);
    const phase = between(0, tau);
    const pitch = basePitch * between(0.90, 1.08);
    const formants = [between(290, 540), between(850, 1350), between(1700, 2350)];
    const gain = between(0.027, 0.047);
    const partials = [];
    for (let h = 1; h < 20; h++) {
      const frequency = pitch * h;
      const weight = formants.reduce((sum, f, k) => sum + (k === 0 ? 1 : 0.45) * Math.exp(-(((frequency - f) / (k === 0 ? 170 : 260)) ** 2)), 0);
      if (weight > 0.03) partials.push([h, weight / Math.sqrt(h), between(0, tau)]);
    }
    let noise = 0;
    for (let i = 0; i < length * sampleRate; i++) {
      const t = i / sampleRate;
      const rise = smooth(Math.min(1, t / 0.14));
      const fall = smooth(Math.max(0, Math.min(1, (length - t) / 0.25)));
      const syllable = 0.12 + 0.88 * Math.max(0, Math.sin(tau * pace * t + phase)) ** 1.6;
      const drift = 0.027 * Math.sin(tau * 0.7 * t + phase);
      let voice = 0;
      for (const [h, weight, p] of partials) {
        voice += weight * Math.sin(tau * pitch * h * t + drift * h + p);
      }
      noise = 0.72 * noise + 0.28 * (random() * 2 - 1);
      at(room, start, i, gain * rise * fall * syllable * (0.13 * voice + 0.75 * noise));
    }
    cursor += length + between(0.35, 1.5);
  }
}

// Sparse, small tableware events, with softened attacks and damped resonances.
for (let event = 0; event < 19; event++) {
  const time = (event + between(0.1, 0.9)) * duration / 19;
  const start = Math.round(time * sampleRate);
  const glass = event % 3 === 0;
  const f = glass ? between(1450, 1950) : between(820, 1400);
  const gain = glass ? between(0.018, 0.028) : between(0.006, 0.016);
  const length = glass ? 0.62 : 0.22;
  for (let i = 0; i < length * sampleRate; i++) {
    const t = i / sampleRate;
    const attack = Math.min(1, t / 0.004);
    const release = Math.min(1, (length - t) / 0.035);
    const resonances = Math.sin(tau * f * t) + 0.35 * Math.sin(tau * f * 1.43 * t)
      + 0.16 * Math.sin(tau * f * 2.07 * t);
    at(tableware, start, i, gain * attack * release * Math.exp(-(glass ? 13 : 30) * t) * resonances);
  }
}

function rms(bus) {
  return Math.sqrt(bus.reduce((sum, value) => sum + value * value, 0) / bus.length);
}
function normalize(bus, target) {
  const gain = target / rms(bus);
  for (let i = 0; i < count; i++) bus[i] *= gain;
}

// Wordless room sound is the principal bed. Music stays well behind it.
normalize(room, 0.82);
normalize(music, 0.30);
normalize(tableware, 0.16);
const dry = Float64Array.from(room, (value, i) => value + music[i] + tableware[i]);
const wet = new Float64Array(count);
const reflections = [[0, 0.78], [0.043, 0.12], [0.079, 0.09], [0.131, 0.065], [0.197, 0.045], [0.283, 0.023]];
for (let i = 0; i < count; i++) {
  for (const [delay, gain] of reflections) wet[i] += dry[(i - Math.round(delay * sampleRate) + count) % count] * gain;
}

// Periodic one-pole filters settle across repeated data: continuous low-pass
// around 3 kHz, with sub-bass removed. Room tone should never mask a caller.
const lowA = 1 - Math.exp(-tau * 2800 / sampleRate);
const highA = 1 - Math.exp(-tau * 190 / sampleRate);
let low = 0;
let high = 0;
const filtered = new Float64Array(count);
for (let pass = 0; pass < 2; pass++) {
  for (let i = 0; i < count; i++) {
    low += lowA * (wet[i] - low);
    high += highA * (low - high);
    filtered[i] = low - high;
  }
}

// Only a 6 ms edge taper: a smooth join when a fresh call starts playback.
const taperSamples = Math.round(sampleRate * 0.006);
for (let i = 0; i < taperSamples; i++) {
  filtered[i] *= smooth(i / taperSamples);
  filtered[count - 1 - i] *= smooth(i / taperSamples);
}
// Round off isolated clinks so their peaks do not jump toward voice level.
const softCeiling = rms(filtered) * 3;
for (let i = 0; i < count; i++) filtered[i] = softCeiling * Math.tanh(filtered[i] / softCeiling);
normalize(filtered, 10 ** (-39 / 20));

const output = resolve(process.argv[2] || "public/audio/le-yard-room-tone.wav");
const pcm = Buffer.alloc(count * 2);
let peak = 0;
let energy = 0;
for (let i = 0; i < count; i++) {
  const sample = Math.round(Math.max(-1, Math.min(1, filtered[i])) * 32767);
  pcm.writeInt16LE(sample, i * 2);
  const amplitude = sample / 32768;
  peak = Math.max(peak, Math.abs(amplitude));
  energy += amplitude * amplitude;
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, Buffer.concat([header, pcm]));
console.log(JSON.stringify({
  output,
  durationSeconds: duration,
  sampleRate,
  channels: 1,
  sampleFormat: "pcm_s16le",
  rmsDbfs: Number((20 * Math.log10(Math.sqrt(energy / count))).toFixed(2)),
  peakDbfs: Number((20 * Math.log10(peak)).toFixed(2)),
  rights: "Original procedural synthesis. No recorded speech, samples, or external music.",
}, null, 2));
