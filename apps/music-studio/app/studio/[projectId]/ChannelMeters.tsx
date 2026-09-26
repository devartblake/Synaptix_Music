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
