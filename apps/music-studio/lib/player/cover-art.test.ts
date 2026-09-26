import assert from "node:assert/strict";
import test from "node:test";

import { COVER_MAX_INPUT_BYTES, COVER_OUTPUT_SIZE, CoverArtError, squareCrop, validateCoverFile } from "./cover-art.ts";

test("covers are center-cropped to a square and never upscaled", () => {
  assert.deepEqual(squareCrop(3000, 2000), { sx: 500, sy: 0, size: 2000, output: COVER_OUTPUT_SIZE });
  assert.deepEqual(squareCrop(600, 900), { sx: 0, sy: 150, size: 600, output: 600 });
  assert.deepEqual(squareCrop(1024, 1024), { sx: 0, sy: 0, size: 1024, output: 1024 });
  assert.throws(() => squareCrop(40, 900), CoverArtError);
  assert.throws(() => squareCrop(Number.NaN, 900), CoverArtError);
});

test("only reasonably sized PNG, JPEG, and WebP files are accepted", () => {
  assert.doesNotThrow(() => validateCoverFile({ type: "image/png", size: 1024 }));
  assert.doesNotThrow(() => validateCoverFile({ type: "image/webp", size: COVER_MAX_INPUT_BYTES }));
  assert.throws(() => validateCoverFile({ type: "image/gif", size: 1024 }), /PNG, JPEG, or WebP/);
  assert.throws(() => validateCoverFile({ type: "image/svg+xml", size: 1024 }), CoverArtError);
  assert.throws(() => validateCoverFile({ type: "image/jpeg", size: COVER_MAX_INPUT_BYTES + 1 }), /20 MB/);
});
