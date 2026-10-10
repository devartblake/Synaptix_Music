"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { SILENT_METER, type AudioTransport, type MasterMeterSnapshot } from "@synaptix/daw-engine";
import { MeterBar } from "../../../components/ui/StudioControls";
import styles from "./mixer.module.css";

const Levels = createContext<Record<string, MasterMeterSnapshot>>({});
export function ChannelMeters({
  engine,
  children
}: {
  engine: AudioTransport;
  children: ReactNode;
}) {
  const [levels, setLevels] = useState<Record<string, MasterMeterSnapshot>>({});
  useEffect(() => engine.subscribeChannelMeters(setLevels), [engine]);
  return <Levels.Provider value={levels}>{children}</Levels.Provider>;
}
export function ChannelMeter({ id, name }: { id: string; name: string }) {
  const meter = useContext(Levels)[id] ?? SILENT_METER;
  const db = (value: number) => (Number.isFinite(value) ? `${value.toFixed(1)} dBFS` : "Silent");
  return (
    <div className={styles.levels}>
      <MeterBar label={`${name} peak`} value={meter.peakDbfs} clipped={meter.clipped} />
      <small>
        Peak {db(meter.peakDbfs)} · RMS {db(meter.rmsDbfs)}
        {meter.clipped ? " · Clipping" : ""}
      </small>
    </div>
  );
}

/** A slim vertical level for a timeline track header (the DAW layout). */
export function TrackLevel({ id, name }: { id: string; name: string }) {
  const meter = useContext(Levels)[id] ?? SILENT_METER;
  // -60 dBFS to 0 dBFS fills the bar.
  const fill = Number.isFinite(meter.peakDbfs) ? Math.max(0, Math.min(1, (meter.peakDbfs + 60) / 60)) : 0;
  return (
    <span className="track-level" role="meter" aria-label={`${name} level`} aria-valuemin={-60} aria-valuemax={0}
      aria-valuenow={Number.isFinite(meter.peakDbfs) ? Math.round(meter.peakDbfs) : -60}
      data-clipped={meter.clipped || undefined}>
      <span style={{ transform: `scaleY(${fill})` }} />
    </span>
  );
}
