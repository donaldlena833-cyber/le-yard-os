// Raw mono audio only: Twilio PCMU at 8 kHz; Gemini PCM16LE at 16/24 kHz.
// Uses Web APIs so the same codec runs in a Worker and in Node's test runner.
const MAX_INPUT_BYTES = 65_536;
const MAX_BASE64_LENGTH = Math.ceil(MAX_INPUT_BYTES / 3) * 4;
const FIR_LENGTH = 63;

function decodeBase64(value) {
  if (typeof value !== "string") throw new Error("invalid_audio_base64");
  if (value.length > MAX_BASE64_LENGTH) throw new Error("audio_chunk_too_large");
  if (value.length % 4 !== 0) throw new Error("invalid_audio_base64");
  let binary;
  try {
    binary = atob(value);
    // Reject whitespace, invalid padding, URL alphabet, and nonzero pad bits.
    if (btoa(binary) !== value) throw new Error();
  } catch {
    throw new Error("invalid_audio_base64");
  }
  if (binary.length > MAX_INPUT_BYTES) throw new Error("audio_chunk_too_large");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeBase64(bytes) {
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return btoa(parts.join(""));
}

// G.711 mu-law has two zero codes; encoding canonicalizes both to 0xff.
const MULAW_PCM = Int16Array.from({ length: 256 }, (_, byte) => {
  const value = (~byte) & 0xff;
  const magnitude = (((value & 0x0f) << 3) + 0x84) << ((value >> 4) & 7);
  return value & 0x80 ? 0x84 - magnitude : magnitude - 0x84;
});

function encodeMulaw(sample) {
  const rounded = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = rounded < 0 ? 0x80 : 0;
  const magnitude = Math.min(Math.abs(rounded), 32635) + 0x84;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && !(magnitude & mask); mask >>= 1) exponent--;
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

// Hamming-windowed sinc: retain telephone speech while suppressing frequencies
// that would fold into 0–4 kHz during 3:1 decimation. Unity DC gain; ~1.3 ms delay.
const LOWPASS = (() => {
  const coefficients = new Float64Array(FIR_LENGTH);
  const cutoff = 3400 / 24000;
  const center = (FIR_LENGTH - 1) / 2;
  let sum = 0;
  for (let i = 0; i < FIR_LENGTH; i++) {
    const distance = i - center;
    const sinc = distance === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * distance) / (Math.PI * distance);
    coefficients[i] = sinc * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (FIR_LENGTH - 1)));
    sum += coefficients[i];
  }
  for (let i = 0; i < FIR_LENGTH; i++) coefficients[i] /= sum;
  return coefficients;
})();

/** One codec per call. Keep it across media chunks; resetOutput on interruption. */
export function createAudioCodec() {
  let previousInput;
  const filter = new Float64Array(FIR_LENGTH);
  let writeIndex = 0;
  let decimationPhase = 0;
  let pendingLowByte = null;

  function mulawToPcm16k(base64MuLaw) {
    const input = decodeBase64(base64MuLaw);
    const output = new Uint8Array(input.length * 4);
    const view = new DataView(output.buffer);
    for (let i = 0; i < input.length; i++) {
      const current = MULAW_PCM[input[i]];
      // Causal linear interpolation retains the midpoint across chunk edges.
      // Duplicate the first sample to avoid inventing a startup ramp from zero.
      const midpoint = previousInput === undefined ? current : Math.round((previousInput + current) / 2);
      view.setInt16(i * 4, midpoint, true);
      view.setInt16(i * 4 + 2, current, true);
      previousInput = current;
    }
    return encodeBase64(output);
  }

  function pcm24kToMulaw(base64Pcm) {
    const input = decodeBase64(base64Pcm);
    const sampleCount = Math.floor((input.length + (pendingLowByte === null ? 0 : 1)) / 2);
    const output = new Uint8Array(Math.floor((decimationPhase + sampleCount) / 3));
    let outputIndex = 0;

    function consume(low, high) {
      filter[writeIndex] = ((low | (high << 8)) << 16) >> 16;
      writeIndex = (writeIndex + 1) % FIR_LENGTH;
      decimationPhase++;
      if (decimationPhase !== 3) return;
      decimationPhase = 0;
      let sample = 0;
      let index = (writeIndex + FIR_LENGTH - 1) % FIR_LENGTH;
      for (let tap = 0; tap < FIR_LENGTH; tap++) {
        sample += LOWPASS[tap] * filter[index];
        index = index === 0 ? FIR_LENGTH - 1 : index - 1;
      }
      output[outputIndex++] = encodeMulaw(sample);
    }

    let offset = 0;
    if (pendingLowByte !== null && input.length) {
      consume(pendingLowByte, input[0]);
      pendingLowByte = null;
      offset = 1;
    }
    for (; offset + 1 < input.length; offset += 2) consume(input[offset], input[offset + 1]);
    if (offset < input.length) pendingLowByte = input[offset];
    return encodeBase64(output);
  }

  function resetInput() {
    previousInput = undefined;
  }

  function resetOutput() {
    filter.fill(0);
    writeIndex = 0;
    decimationPhase = 0;
    pendingLowByte = null;
  }

  return {
    mulawToPcm16k,
    pcm24kToMulaw,
    resetInput,
    resetOutput,
    reset() { resetInput(); resetOutput(); },
  };
}

/** Independent clip conversion. Use createAudioCodec for streaming chunks. */
export function mulawToPcm16k(base64MuLaw) {
  return createAudioCodec().mulawToPcm16k(base64MuLaw);
}

/** Independent PCM clip: whole 16-bit samples; omit <3 trailing decimator samples. */
export function pcm24kToMulaw(base64Pcm) {
  // The streaming method accepts byte-split samples; a standalone clip cannot.
  if (decodeBase64(base64Pcm).length % 2 !== 0) throw new Error("invalid_pcm_alignment");
  return createAudioCodec().pcm24kToMulaw(base64Pcm);
}
