"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_FREQUENCY_DRONE_SETTINGS,
  FREQUENCY_DRONE_PRESETS,
  clampDroneSettings,
  type DroneWaveform,
  type FrequencyDroneSettings
} from "../../../lib/audio/frequency-drone-model";

interface FrequencyDroneInstrumentProps {
  onUseForGeneration?(settings: FrequencyDroneSettings): void;
  onAddToProject?(settings: FrequencyDroneSettings): void;
}

export function FrequencyDroneInstrument({ onUseForGeneration, onAddToProject }: FrequencyDroneInstrumentProps) {
  const [settings, setSettings] = useState(DEFAULT_FREQUENCY_DRONE_SETTINGS);
  const [playing, setPlaying] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<{ oscillators: OscillatorNode[]; gain: GainNode } | null>(null);

  function stop(): void {
    const context = contextRef.current;
    const nodes = nodesRef.current;
    if (context && nodes) {
      const now = context.currentTime;
      nodes.gain.gain.cancelScheduledValues(now);
      nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
      nodes.gain.gain.linearRampToValueAtTime(0, now + settings.fadeOutSeconds);
      for (const oscillator of nodes.oscillators) oscillator.stop(now + settings.fadeOutSeconds + 0.02);
    }
    nodesRef.current = null;
    setPlaying(false);
  }

  async function play(): Promise<void> {
    stop();
    const safe = clampDroneSettings(settings);
    const context = contextRef.current ?? new AudioContext();
    contextRef.current = context;
    await context.resume();
    const master = context.createGain();
    master.gain.setValueAtTime(0, context.currentTime);
    master.gain.linearRampToValueAtTime(safe.gain, context.currentTime + safe.fadeInSeconds);
    master.connect(context.destination);

    const frequencies = safe.stereoDetuneHz > 0
      ? [safe.frequencyHz - safe.stereoDetuneHz / 2, safe.frequencyHz + safe.stereoDetuneHz / 2]
      : [safe.frequencyHz];
    const oscillators = frequencies.map((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = safe.waveform;
      oscillator.frequency.value = frequency;
      if (frequencies.length === 2) {
        const pan = context.createStereoPanner();
        pan.pan.value = index === 0 ? -0.65 : 0.65;
        oscillator.connect(pan).connect(master);
      } else oscillator.connect(master);
      oscillator.start();
      return oscillator;
    });
    nodesRef.current = { oscillators, gain: master };
    setPlaying(true);
  }

  useEffect(() => () => {
    for (const oscillator of nodesRef.current?.oscillators ?? []) {
      try { oscillator.stop(); } catch {}
    }
    void contextRef.current?.close();
  }, []);

  function patch(next: Partial<FrequencyDroneSettings>): void {
    const updated = clampDroneSettings({ ...settings, ...next });
    setSettings(updated);
    if (playing) {
      const context = contextRef.current;
      const nodes = nodesRef.current;
      if (context && nodes) {
        nodes.oscillators.forEach((oscillator, index) => {
          const offset = nodes.oscillators.length === 2 ? (index === 0 ? -updated.stereoDetuneHz / 2 : updated.stereoDetuneHz / 2) : 0;
          oscillator.frequency.setTargetAtTime(updated.frequencyHz + offset, context.currentTime, 0.02);
          oscillator.type = updated.waveform;
        });
        nodes.gain.gain.setTargetAtTime(updated.gain, context.currentTime, 0.02);
      }
    }
  }

  return <section className="frequency-drone" aria-label="Frequency Generator and Drone Instrument">
    <div className="frequency-drone-header">
      <div><span className="eyebrow">Tone / Drone Generator</span><h3>Frequency Generator</h3>
        <p>Audible-frequency oscillator for musical drones, procedural seeds and adaptive-state layers.</p></div>
      <strong>{settings.frequencyHz.toFixed(settings.frequencyHz % 1 ? 1 : 0)} Hz</strong>
    </div>
    <label>Preset
      <select value={String(settings.frequencyHz)} onChange={(event) => patch({ frequencyHz: Number(event.target.value) })}>
        {FREQUENCY_DRONE_PRESETS.map((preset) => <option key={preset.id} value={preset.frequencyHz}>{preset.name}</option>)}
      </select>
    </label>
    <div className="generation-fields">
      <label>Frequency (Hz)<input type="number" min="20" max="20000" step="0.1" value={settings.frequencyHz} onChange={(event) => patch({ frequencyHz: event.target.valueAsNumber })} /></label>
      <label>Waveform<select value={settings.waveform} onChange={(event) => patch({ waveform: event.target.value as DroneWaveform })}><option value="sine">Sine</option><option value="triangle">Triangle</option><option value="sawtooth">Sawtooth</option><option value="square">Square</option></select></label>
      <label>Fade in (s)<input type="number" min="0.01" max="10" step="0.1" value={settings.fadeInSeconds} onChange={(event) => patch({ fadeInSeconds: event.target.valueAsNumber })} /></label>
      <label>Fade out (s)<input type="number" min="0.01" max="10" step="0.1" value={settings.fadeOutSeconds} onChange={(event) => patch({ fadeOutSeconds: event.target.valueAsNumber })} /></label>
    </div>
    <label>Output <output>{Math.round(settings.gain * 100)}%</output><input type="range" min="0" max="0.35" step="0.01" value={settings.gain} onChange={(event) => patch({ gain: Number(event.target.value) })} /></label>
    <label>Stereo / binaural offset <output>{settings.stereoDetuneHz.toFixed(1)} Hz</output><input type="range" min="0" max="40" step="0.5" value={settings.stereoDetuneHz} onChange={(event) => patch({ stereoDetuneHz: Number(event.target.value) })} /></label>
    <div className="frequency-drone-actions">
      <button type="button" onClick={() => playing ? stop() : void play()}>{playing ? "Stop tone" : "Preview tone"}</button>
      {onUseForGeneration && <button type="button" onClick={() => onUseForGeneration(settings)}>Use as generation seed</button>}
      {onAddToProject && <button type="button" onClick={() => onAddToProject(settings)}>Add as DAW device</button>}
    </div>
    <p className="apply-note">Presets are creative frequency references, not therapeutic claims. Keep monitoring levels comfortable, especially with headphones.</p>
  </section>;
}
