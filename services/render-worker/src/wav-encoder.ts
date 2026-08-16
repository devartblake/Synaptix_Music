export interface StereoBuffer {
  left: Float64Array;
  right: Float64Array;
}

export type WavBitDepth = 16 | 24 | 32;

function writeInt24LE(buffer: Buffer, value: number, offset: number): void {
  const unsigned = value < 0 ? value + 0x1000000 : value;
  buffer[offset] = unsigned & 0xff;
  buffer[offset + 1] = (unsigned >> 8) & 0xff;
  buffer[offset + 2] = (unsigned >> 16) & 0xff;
}

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

  const maxInt = 2 ** (bitDepth - 1) - 1;
  const minInt = -(2 ** (bitDepth - 1));
  let offset = headerSize;

  for (let frame = 0; frame < numFrames; frame++) {
    const left = buffer.left[frame] ?? 0;
    const right = buffer.right[frame] ?? 0;
    for (const channelValue of [left, right]) {
      const clamped = Math.max(-1, Math.min(1, channelValue));
      const intValue = Math.round(clamped * (clamped < 0 ? -minInt : maxInt));
      if (bitDepth === 16) {
        out.writeInt16LE(intValue, offset);
        offset += 2;
      } else if (bitDepth === 24) {
        writeInt24LE(out, intValue, offset);
        offset += 3;
      } else {
        out.writeInt32LE(intValue, offset);
        offset += 4;
      }
    }
  }

  return out;
}
