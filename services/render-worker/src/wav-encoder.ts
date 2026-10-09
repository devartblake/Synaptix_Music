export interface StereoBuffer {
  left: Float64Array;
  right: Float64Array;
}

export type WavBitDepth = 16 | 24 | 32;

// Standard 44-byte RIFF/WAVE PCM header followed by interleaved little-endian
// signed-integer samples. 32-bit output is PCM (AudioFormat 1), not IEEE float.
export function encodeWav(buffer: StereoBuffer, sampleRate: number, bitDepth: WavBitDepth): Buffer {
  if (buffer.left.length !== buffer.right.length) {
    throw new Error("Left and right channel buffers must have equal length.");
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error("sampleRate must be a positive integer.");
  }

  const numChannels = 2;
  const numFrames = buffer.left.length;
  const bytesPerSample = bitDepth / 8;
  const dataSize = numFrames * numChannels * bytesPerSample;
  const headerSize = 44;
  const out = Buffer.alloc(headerSize + dataSize);

  out.write("RIFF", 0, "ascii");
  out.writeUInt32LE(36 + dataSize, 4);
  out.write("WAVE", 8, "ascii");
  out.write("fmt ", 12, "ascii");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(numChannels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  out.writeUInt16LE(numChannels * bytesPerSample, 32);
  out.writeUInt16LE(bitDepth, 34);
  out.write("data", 36, "ascii");
  out.writeUInt32LE(dataSize, 40);

  // Profiling put this loop at about a fifth of a render (docs/development/dsp-profiling.md):
  // it allocated a two-element array per frame and wrote through bounds-checked Buffer
  // methods. It now writes the little-endian bytes directly with no per-frame allocation.
  // Output is byte-identical: values are clamped to [-1, 1], rounded, and NaN writes 0.
  const positiveScale = 2 ** (bitDepth - 1) - 1;
  const negativeScale = 2 ** (bitDepth - 1);
  const { left, right } = buffer;
  let offset = headerSize;

  for (let frame = 0; frame < numFrames; frame++) {
    for (let channel = 0; channel < 2; channel++) {
      const value = channel === 0 ? left[frame]! : right[frame]!;
      const clamped = value < -1 ? -1 : value > 1 ? 1 : value;
      const sample = Math.round(clamped * (clamped < 0 ? negativeScale : positiveScale));
      out[offset] = sample & 0xff;
      out[offset + 1] = (sample >> 8) & 0xff;
      if (bytesPerSample > 2) out[offset + 2] = (sample >> 16) & 0xff;
      if (bytesPerSample > 3) out[offset + 3] = (sample >> 24) & 0xff;
      offset += bytesPerSample;
    }
  }

  return out;
}

/** Decodes a PCM WAV (16/24/32-bit, mono or stereo) as written by encodeWav, for frozen playback. */
export function decodeWav(bytes: Buffer): { buffer: StereoBuffer; sampleRate: number } {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file.");
  }
  let offset = 12;
  let format: { channels: number; sampleRate: number; bitDepth: number } | null = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      if (bytes.readUInt16LE(body) !== 1) throw new Error("Only PCM WAV files can be decoded.");
      format = {
        channels: bytes.readUInt16LE(body + 2),
        sampleRate: bytes.readUInt32LE(body + 4),
        bitDepth: bytes.readUInt16LE(body + 14)
      };
    } else if (id === "data") {
      if (!format) throw new Error("WAV data appears before its format.");
      const { channels, bitDepth } = format;
      if (![16, 24, 32].includes(bitDepth) || channels < 1 || channels > 2) {
        throw new Error(`Unsupported WAV layout (${channels} channels, ${bitDepth}-bit).`);
      }
      const bytesPerSample = bitDepth / 8;
      const frames = Math.floor(Math.min(size, bytes.length - body) / (bytesPerSample * channels));
      const left = new Float64Array(frames);
      const right = new Float64Array(frames);
      const max = 2 ** (bitDepth - 1);
      for (let frame = 0; frame < frames; frame++) {
        for (let channel = 0; channel < channels; channel++) {
          const at = body + (frame * channels + channel) * bytesPerSample;
          const raw = bitDepth === 16 ? bytes.readInt16LE(at) : bitDepth === 24 ? bytes.readIntLE(at, 3) : bytes.readInt32LE(at);
          const value = raw < 0 ? raw / max : raw / (max - 1);
          if (channel === 0) left[frame] = value;
          if (channel === 1 || channels === 1) right[frame] = value;
        }
      }
      return { buffer: { left, right }, sampleRate: format.sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV file has no data.");
}
