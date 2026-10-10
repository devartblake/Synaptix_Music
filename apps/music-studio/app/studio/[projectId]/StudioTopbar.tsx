"use client";

import type { BrowserAudioEngine } from "@synaptix/daw-engine";

import { Button } from "../../../components/ui/StudioControls";
import { PlatformAccount } from "../../../components/PlatformAccount";
import { MasterMeter } from "./MasterMeter";
import { ProjectTitle } from "./ProjectTitle";

export interface StudioTopbarProps {
  engine: BrowserAudioEngine;
  name: string;
  bpm: number;
  storageStatus: string;
  renameDisabled: boolean;
  onRename: (next: string) => Promise<void>;
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  loopEnabled: boolean;
  onToggleLoop: () => void;
  onTempo: (next: number) => void;
  onSyncNow: () => void;
  saveState: { readOnly: boolean; state: string };
  syncLabel: string;
  syncTone: string;
}

/** Project title, transport, save and sync state, master meter and account. */
export function StudioTopbar(props: StudioTopbarProps) {
  const { engine, name, bpm, storageStatus, playing, saveState: session } = props;
  return (
    <header className="studio-topbar">
      <div className="studio-brand">
        <a className="studio-home" href="/" aria-label="Back to projects"><span className="studio-mark" aria-hidden="true">S</span><span>Projects</span></a>
        <div className="studio-title">
          <ProjectTitle name={name} disabled={props.renameDisabled} onRename={props.onRename} />
          <small>{bpm} BPM · {storageStatus}</small>
        </div>
      </div>
      <div className="transport" aria-label="Transport controls">
        <Button className="transport-primary" onClick={playing ? props.onPause : props.onPlay}>{playing ? "Pause" : "Play"}</Button>
        <Button onClick={props.onStop}>Stop</Button>
        <Button disabled={!props.canUndo} onClick={props.onUndo}>Undo</Button>
        <Button disabled={!props.canRedo} onClick={props.onRedo}>Redo</Button>
        <Button onClick={props.onToggleLoop}>
          Loop: {props.loopEnabled ? "On" : "Off"}
        </Button>
        <label>Tempo <input type="number" min={20} max={300} value={bpm}
          onChange={(event) => {
            const raw = event.currentTarget.value;
            const next = event.currentTarget.valueAsNumber;
            if (raw === "" || !Number.isFinite(next) || next < 20 || next > 300 || next === bpm) return;
            props.onTempo(next);
          }} style={{ width: 64 }} /></label>
        <Button onClick={props.onSyncNow}>Sync now</Button>
      </div>
      <div className="studio-status">
        <span className="status-pill" role="status" aria-label="Save state">
          <span className={`status-dot ${session.state === "failed" ? "danger" : session.state === "saving" ? "warning" : ""}`} />
          {session.readOnly ? "Read-only" : session.state === "saving" ? "Saving…" : session.state === "failed" ? "Not saved" : session.state === "unsaved" ? "Unsaved" : "Saved"}
        </span>
        <span className="status-pill"><span className={`status-dot ${props.syncTone}`} />{props.syncLabel}</span>
        <MasterMeter engine={engine} />
        <PlatformAccount compact />
      </div>
    </header>
  );
}
