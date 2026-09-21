import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { FfmpegTranscoder } from "./ffmpeg-transcoder.ts";
import { encodeWav } from "./wav-encoder.ts";

const ffmpegAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;

test(
  "FFmpeg creates deterministic MP3 and OGG delivery artifacts",
  { skip: !ffmpegAvailable },
  async () => {
    const frames = 4410;
    const left = new Float64Array(frames);
    const right = new Float64Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = Math.sin((2 * Math.PI * 440 * i) / 44100) * 0.2;
      right[i] = left[i]!;
    }
    const wav = encodeWav({ left, right }, 44100, 16);
    const transcoder = new FfmpegTranscoder();

    for (const format of ["mp3", "ogg"] as const) {
      const first = await transcoder.transcodeWav(wav, { format, bitrateKbps: 128 });
      const second = await transcoder.transcodeWav(wav, { format, bitrateKbps: 128 });
      assert.ok(first.length > 0);
      assert.ok(first.equals(second), `${format} output should be byte-identical`);
    }
  }
);
