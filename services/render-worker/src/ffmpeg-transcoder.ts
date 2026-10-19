import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Everything the worker encodes from its WAV: lossy formats plus lossless FLAC. */
export type EncodedAudioFormat = "mp3" | "ogg" | "m4a" | "opus" | "flac";

export interface AudioTranscodeRequest {
  format: EncodedAudioFormat;
  /** Ignored for FLAC, which is lossless. */
  bitrateKbps: number;
  maxDurationSeconds?: number;
  /** Written as ID3 TXXX frames (MP3), Vorbis comments (OGG, FLAC) or MP4 metadata (M4A, Opus); see ai-marking.ts. */
  tags?: Record<string, string>;
}

export interface AudioTranscoder {
  transcodeWav(wavBytes: Buffer, request: AudioTranscodeRequest): Promise<Buffer>;
}

function oggCrc32(page: Buffer): number {
  let crc = 0;
  for (const byte of page) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80000000) !== 0 ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0;
    }
  }
  return crc >>> 0;
}

// FFmpeg assigns a random Ogg logical-stream serial. Canonicalize it and each
// page CRC so identical render inputs remain byte-identical across retries.
function canonicalizeOgg(bytes: Buffer, source: Buffer): Buffer {
  const output = Buffer.from(bytes);
  const serial = createHash("sha256").update(source).digest().readUInt32LE(0);
  let offset = 0;
  while (offset < output.length) {
    if (output.toString("ascii", offset, offset + 4) !== "OggS" || offset + 27 > output.length) {
      throw new Error("FFmpeg produced an invalid Ogg page.");
    }
    const segmentCount = output[offset + 26]!;
    const headerLength = 27 + segmentCount;
    if (offset + headerLength > output.length)
      throw new Error("FFmpeg produced a truncated Ogg page.");
    let bodyLength = 0;
    for (let i = 0; i < segmentCount; i++) bodyLength += output[offset + 27 + i]!;
    const pageLength = headerLength + bodyLength;
    if (offset + pageLength > output.length)
      throw new Error("FFmpeg produced a truncated Ogg body.");

    output.writeUInt32LE(serial, offset + 14);
    output.writeUInt32LE(0, offset + 22);
    const crc = oggCrc32(output.subarray(offset, offset + pageLength));
    output.writeUInt32LE(crc, offset + 22);
    offset += pageLength;
  }
  return output;
}

export class FfmpegTranscoder implements AudioTranscoder {
  constructor(private readonly executable = process.env.RENDER_WORKER_FFMPEG_PATH ?? "ffmpeg") {}

  async transcodeWav(wavBytes: Buffer, request: AudioTranscodeRequest): Promise<Buffer> {
    if (
      request.format !== "flac" &&
      (!Number.isInteger(request.bitrateKbps) || request.bitrateKbps < 64 || request.bitrateKbps > 320)
    ) {
      throw new Error("Lossy bitrate must be an integer between 64 and 320 kbps.");
    }
    if (
      request.maxDurationSeconds !== undefined &&
      (!Number.isFinite(request.maxDurationSeconds) || request.maxDurationSeconds <= 0)
    ) {
      throw new Error("Preview duration must be positive.");
    }

    const bitrate = `${request.bitrateKbps}k`;
    // MP4 keeps arbitrary tags only with use_metadata_tags; +bitexact zeroes its creation times.
    const mp4Tags = ["-movflags", "+use_metadata_tags"];
    const codecArguments = {
      mp3: ["-c:a", "libmp3lame", "-b:a", bitrate, "-write_xing", "0", "-f", "mp3"],
      ogg: ["-c:a", "libvorbis", "-b:a", bitrate, "-serial_offset", "0", "-f", "ogg"],
      m4a: ["-c:a", "aac", "-b:a", bitrate, ...mp4Tags, "-f", "ipod"],
      opus: ["-c:a", "libopus", "-b:a", bitrate, ...mp4Tags, "-f", "mp4"],
      flac: ["-c:a", "flac", "-f", "flac"]
    }[request.format];
    // MP4 and FLAC write their index or stream info after the audio, so they need a seekable file.
    const seekable = request.format === "m4a" || request.format === "opus" || request.format === "flac";
    const directory = seekable ? await mkdtemp(join(tmpdir(), "synaptix-transcode-")) : null;
    const output = directory ? join(directory, `out.${request.format}`) : "pipe:1";
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-fflags",
      "+bitexact",
      "-flags:a",
      "+bitexact",
      "-f",
      "wav",
      "-i",
      "pipe:0",
      "-map_metadata",
      "-1",
      ...Object.entries(request.tags ?? {}).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]),
      "-vn",
      ...(request.maxDurationSeconds === undefined
        ? []
        : ["-t", String(request.maxDurationSeconds)]),
      ...codecArguments,
      ...(directory ? ["-y"] : []),
      output
    ];

    try {
      const piped = await this.run(args, wavBytes, request.format);
      const bytes = directory ? await readFile(output) : piped;
      if (bytes.length === 0) throw new Error(`FFmpeg ${request.format} conversion produced an empty artifact.`);
      return request.format === "ogg" ? canonicalizeOgg(bytes, wavBytes) : bytes;
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }

  private run(args: string[], wavBytes: Buffer, format: EncodedAudioFormat): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const child = spawn(this.executable, args, { stdio: ["pipe", "pipe", "pipe"] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", (error) =>
        reject(new Error(`FFmpeg could not start from '${this.executable}': ${error.message}`))
      );
      child.once("close", (code) => {
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString("utf8").trim();
          reject(new Error(`FFmpeg ${format} conversion failed (${code}): ${detail}`));
          return;
        }
        resolve(Buffer.concat(stdout));
      });
      child.stdin.end(wavBytes);
    });
  }
}
