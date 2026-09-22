"use client";

import { useEffect, useState } from "react";
import { MeterBar } from "../../../components/ui/StudioControls";

import type { AudioTransport, MasterMeterSnapshot } from "@synaptix/daw-engine";
import { SILENT_METER } from "@synaptix/daw-engine";

function formatDb(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)} dBFS` : "−∞ dBFS";
}

export function MasterMeter({ engine }: { engine: AudioTransport }) {
  const [meter, setMeter] = useState<MasterMeterSnapshot>(SILENT_METER);

  useEffect(() => engine.subscribeMeter(setMeter, 50), [engine]);

  return (
    <section aria-label="Master output meter" style={{ minWidth: 180, display: "grid", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <strong>Master</strong>
        <span>{formatDb(meter.peakDbfs)}</span>
      </div>
      <MeterBar label="Master peak level" value={meter.peakDbfs} clipped={meter.clipped} />
      <small style={{ color: meter.clipped ? "#ff8f8f" : "#a7afbd" }}>
        RMS {formatDb(meter.rmsDbfs)}{meter.clipped ? " · CLIP" : ""}
      </small>
    </section>
  );
}
