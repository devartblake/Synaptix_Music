"use client";

import { useEffect, useState } from "react";

import type { AudioTransport, MasterMeterSnapshot } from "@synaptix/daw-engine";
import { SILENT_METER } from "@synaptix/daw-engine";

function formatDb(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)} dBFS` : "−∞ dBFS";
}

export function MasterMeter({ engine }: { engine: AudioTransport }) {
  const [meter, setMeter] = useState<MasterMeterSnapshot>(SILENT_METER);

  useEffect(() => engine.subscribeMeter(setMeter, 50), [engine]);

  const peakPercent = Number.isFinite(meter.peakDbfs)
    ? Math.max(0, Math.min(100, ((meter.peakDbfs + 60) / 60) * 100))
    : 0;

  return (
    <section aria-label="Master output meter" style={{ minWidth: 180, display: "grid", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <strong>Master</strong>
        <span>{formatDb(meter.peakDbfs)}</span>
      </div>
      <div style={{ height: 10, borderRadius: 999, background: "#242933", overflow: "hidden" }}>
        <div style={{ width: `${peakPercent}%`, height: "100%", background: meter.clipped ? "#e05252" : "#70c48f" }} />
      </div>
      <small style={{ color: meter.clipped ? "#ff8f8f" : "#a7afbd" }}>
        RMS {formatDb(meter.rmsDbfs)}{meter.clipped ? " · CLIP" : ""}
      </small>
    </section>
  );
}
