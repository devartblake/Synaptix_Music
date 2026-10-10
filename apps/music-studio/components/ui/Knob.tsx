"use client";

import { useEffect, useRef, useState } from "react";

const KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"]);
/** Pixels of vertical drag for the whole range. */
const DRAG_RANGE = 160;

/**
 * A rotary control (Studio UI v2 device chain). Like CommitSlider it previews locally and commits
 * one command per gesture: a drag, a run of key presses, or a double-click back to the default.
 * Ranges that span two decades or more (filter cutoff) move logarithmically.
 */
export function Knob({ label, value, min, max, step, defaultValue, format, disabled, onCommit }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Double-click returns here. */
  defaultValue: number;
  format: (value: number) => string;
  disabled: boolean;
  onCommit: (value: number) => Promise<void>;
}) {
  const logarithmic = min > 0 && max / min >= 100;
  const toPosition = (v: number) => logarithmic
    ? Math.log(v / min) / Math.log(max / min)
    : (v - min) / (max - min);
  const fromPosition = (position: number) => {
    const p = Math.max(0, Math.min(1, position));
    const raw = logarithmic ? min * Math.pow(max / min, p) : min + p * (max - min);
    const rounded = Math.round(raw / step) * step;
    return Number(Math.max(min, Math.min(max, rounded)).toFixed(6));
  };

  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const drag = useRef<{ y: number; position: number } | null>(null);
  useEffect(() => {
    if (!active.current && !pending) setDraft(value);
  }, [value, pending]);

  async function commit(next: number) {
    active.current = false;
    if (next === value) return;
    setPending(true);
    setError(null);
    try {
      await onCommit(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The value could not be saved.");
    } finally {
      setPending(false);
    }
  }

  const position = Math.max(0, Math.min(1, toPosition(draft)));
  const angle = -135 + position * 270;
  const point = (degrees: number, radius: number) => {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return `${20 + radius * Math.cos(radians)} ${20 + radius * Math.sin(radians)}`;
  };
  const off = disabled || pending;

  return (
    <div className="knob">
      <div
        role="slider"
        tabIndex={off ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={draft}
        aria-valuetext={format(draft)}
        aria-disabled={off || undefined}
        title={`${label}: drag up or down, or use the arrow keys. Double-click to reset.`}
        className="knob-dial"
        onPointerDown={(event) => {
          if (off || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          active.current = true;
          drag.current = { y: event.clientY, position };
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          setDraft(fromPosition(drag.current.position + (drag.current.y - event.clientY) / DRAG_RANGE));
        }}
        onPointerUp={() => {
          if (!drag.current) return;
          drag.current = null;
          void commit(draft);
        }}
        onPointerCancel={() => {
          drag.current = null;
          active.current = false;
          setDraft(value);
        }}
        onDoubleClick={() => { if (!off) void commit(defaultValue); }}
        onKeyDown={(event) => {
          if (off || !KEYS.has(event.key)) return;
          event.preventDefault();
          active.current = true;
          const delta = event.key === "PageUp" ? 0.1 : event.key === "PageDown" ? -0.1
            : event.key === "ArrowUp" || event.key === "ArrowRight" ? 0.01 : event.key === "ArrowDown" || event.key === "ArrowLeft" ? -0.01 : 0;
          const next = event.key === "Home" ? min : event.key === "End" ? max : fromPosition(position + delta);
          // Small steps must still move at least one step of the value.
          const nudged = next === draft && delta !== 0 ? Math.max(min, Math.min(max, draft + Math.sign(delta) * step)) : next;
          setDraft(Number(nudged.toFixed(6)));
        }}
        onKeyUp={(event) => { if (KEYS.has(event.key) && active.current) void commit(draft); }}
        onBlur={() => { if (active.current && !drag.current) void commit(draft); }}
      >
        <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
          <path d={`M ${point(-135, 15)} A 15 15 0 1 1 ${point(135, 15)}`} className="knob-track" />
          {position > 0.001 && <path d={`M ${point(-135, 15)} A 15 15 0 ${position * 270 > 180 ? 1 : 0} 1 ${point(angle, 15)}`} className="knob-value" />}
          <line x1="20" y1="20" x2={point(angle, 11).split(" ")[0]} y2={point(angle, 11).split(" ")[1]} className="knob-pointer" />
        </svg>
      </div>
      <span className="knob-label">{label}</span>
      <output className="knob-readout">{format(draft)}</output>
      {error && <span className="knob-error" role="alert">{error}</span>}
    </div>
  );
}
