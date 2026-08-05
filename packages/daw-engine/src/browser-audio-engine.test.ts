import assert from "node:assert/strict";
import test from "node:test";

import { BrowserAudioEngine, SILENT_METER } from "./index.ts";

test("browser audio engine construction is safe without a browser AudioContext", () => {
  const engine = new BrowserAudioEngine();

  assert.deepEqual(engine.meter(), SILENT_METER);
  assert.deepEqual(engine.snapshot(), {
    initialized: false,
    playing: false,
    positionSeconds: 0,
    positionTicks: 0,
    tempo: 120,
    loopEnabled: false
  });

  assert.doesNotThrow(() => engine.dispose());
});
