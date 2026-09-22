"use client";

import { useRef } from "react";
import styles from "./resize-handle.module.css";

export function ResizeHandle({
  label,
  controls,
  orientation,
  value,
  min,
  max,
  direction = 1,
  onChange
}: {
  label: string;
  controls: string;
  orientation: "horizontal" | "vertical";
  value: number;
  min: number;
  max: number;
  direction?: 1 | -1;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ coordinate: number; initial: number } | null>(null);
  const bounded = (next: number) => Math.max(min, Math.min(max, Math.round(next)));
  return (
    <div
      className={`${styles.handle} ${styles[orientation]}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls={controls}
      aria-orientation={orientation}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={`${value} pixels`}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          coordinate: orientation === "vertical" ? event.clientX : event.clientY,
          initial: value
        };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const coordinate = orientation === "vertical" ? event.clientX : event.clientY;
        onChange(
          bounded(drag.current.initial + direction * (coordinate - drag.current.coordinate))
        );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        if (drag.current) onChange(drag.current.initial);
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) {
          onChange(drag.current.initial);
          drag.current = null;
          return;
        }
        const decrease = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
        const increase = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
        const step = event.shiftKey ? 32 : 16;
        const next =
          event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : event.key === decrease
                ? value - direction * step
                : event.key === increase
                  ? value + direction * step
                  : null;
        if (next === null) return;
        event.preventDefault();
        onChange(bounded(next));
      }}
    />
  );
}
