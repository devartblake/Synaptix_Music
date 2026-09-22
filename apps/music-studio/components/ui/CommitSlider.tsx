"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./studio-controls.module.css";

const RANGE_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown"
]);

/** Preview a fader locally and commit one command at the end of a gesture. */
export function CommitSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  disabled,
  onCommit
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  disabled: boolean;
  onCommit: (value: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const interaction = useRef<"pointer" | "keyboard" | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!interaction.current && !pending) setDraft(value);
  }, [value, pending]);

  async function commit(next: number) {
    interaction.current = null;
    if (busy.current || next === value) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await onCommit(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The value could not be saved.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <label className={styles.slider}>
      <span>
        {label}
        <output>{format(draft)}</output>
      </span>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={format(draft)}
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled || pending}
        onPointerDown={(event) => {
          interaction.current = "pointer";
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onKeyDown={(event) => {
          if (RANGE_KEYS.has(event.key)) interaction.current = "keyboard";
        }}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          setDraft(next);
          if (!interaction.current) void commit(next);
        }}
        onPointerUp={(event) => void commit(Number(event.currentTarget.value))}
        onKeyUp={(event) => {
          if (RANGE_KEYS.has(event.key)) void commit(Number(event.currentTarget.value));
        }}
        onBlur={(event) => {
          if (interaction.current) void commit(Number(event.currentTarget.value));
        }}
        onPointerCancel={() => {
          interaction.current = null;
          setDraft(value);
        }}
        onLostPointerCapture={(event) => {
          if (interaction.current === "pointer") void commit(Number(event.currentTarget.value));
        }}
      />
      {error && (
        <span className={styles.sliderError} role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
