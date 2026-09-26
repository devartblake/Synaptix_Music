"use client";

import { useEffect, useState } from "react";
import type { AudioTransport, TransportSnapshot } from "@synaptix/daw-engine";

const STOPPED: TransportSnapshot = {
  initialized: false,
  playing: false,
  positionSeconds: 0,
  positionTicks: 0,
  tempo: 120,
  loopEnabled: false
};

export function useTransport(engine: AudioTransport): TransportSnapshot {
  const [snapshot, setSnapshot] = useState(STOPPED);
  useEffect(
    () =>
      engine.subscribe(
        (next) =>
          setSnapshot((previous) =>
            previous.positionTicks === next.positionTicks &&
            previous.playing === next.playing &&
            previous.tempo === next.tempo &&
            previous.loopEnabled === next.loopEnabled &&
            previous.initialized === next.initialized
              ? previous
              : next
          ),
        50
      ),
    [engine]
  );
  return snapshot;
}
