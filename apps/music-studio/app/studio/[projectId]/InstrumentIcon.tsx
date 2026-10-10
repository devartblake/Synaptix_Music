import type { InstrumentProfileKind } from "@synaptix/daw-engine";

/** Accent per instrument family; also used to tint the picker tile when selected. */
export const INSTRUMENT_ACCENTS: Record<InstrumentProfileKind, string> = {
  drums: "#ff7a59",
  "sub-bass": "#9b5cff",
  bass: "#6379ff",
  lead: "#27d7c4",
  pad: "#8fb8ff",
  pluck: "#f6b84a",
  keys: "#ff6fae",
  organ: "#c58b4f",
  strings: "#e0915a",
  brass: "#f2c94c",
  bell: "#7ee3ff",
  poly: "#8994ff",
  fx: "#b0f06a"
};

// 48×48 line drawings: stroke is currentColor, fills use the accent at low opacity.
const ARTWORK: Record<InstrumentProfileKind, React.ReactNode> = {
  drums: <>
    <path d="M14 6l10 12M34 6L24 18" />
    <ellipse cx="24" cy="21" rx="15" ry="5" fill="var(--instrument-accent)" fillOpacity="0.25" />
    <path d="M9 21v12c0 2.8 6.7 5 15 5s15-2.2 15-5V21M15 25.2v11M24 26v12M33 25.2v11" />
  </>,
  "sub-bass": <>
    <rect x="10" y="5" width="28" height="38" rx="4" />
    <circle cx="24" cy="13" r="3" />
    <circle cx="24" cy="29" r="10" fill="var(--instrument-accent)" fillOpacity="0.2" />
    <circle cx="24" cy="29" r="4" fill="var(--instrument-accent)" fillOpacity="0.6" />
  </>,
  bass: <g transform="rotate(30 24 24)">
    <rect x="21" y="2" width="6" height="7" rx="1.5" />
    <path d="M19 4h2M19 7h2M27 4h2M27 7h2M22 9h4v19h-4z" />
    <path d="M18 28c-6 0-8 5-7 9 1 4 4 8 13 8s12-4 13-8-1-9-7-9c-2 0-3 1-6 1s-4-1-6-1z"
      fill="var(--instrument-accent)" fillOpacity="0.25" />
    <rect x="20" y="34" width="8" height="2.5" rx="1" />
  </g>,
  lead: <>
    <path d="M4 38h40" strokeOpacity="0.35" />
    <path d="M4 32L14 12v20l10-20v20l10-20v20l10-20" stroke="var(--instrument-accent)" strokeWidth="2.5" />
  </>,
  pad: <>
    <path d="M4 16q5-8 10 0t10 0 10 0 10 0" />
    <path d="M4 24q5-8 10 0t10 0 10 0 10 0" stroke="var(--instrument-accent)" strokeOpacity="0.8" />
    <path d="M4 32q5-8 10 0t10 0 10 0 10 0" strokeOpacity="0.45" />
  </>,
  pluck: <>
    <path d="M10 8Q24 2 38 12L14 42" fill="var(--instrument-accent)" fillOpacity="0.15" />
    <path d="M10 8v34M7 42h10" />
    <path d="M16 7v32.5M21 7v26.2M26 7.5V27M31 9v11.8" strokeWidth="1.2" strokeOpacity="0.8" />
  </>,
  keys: <>
    <rect x="4" y="8" width="40" height="6" rx="2" fill="var(--instrument-accent)" fillOpacity="0.3" />
    <rect x="4" y="14" width="40" height="24" rx="2" />
    <path d="M9.7 14v24M15.4 14v24M21.1 14v24M26.9 14v24M32.6 14v24M38.3 14v24" strokeWidth="1.2" />
    <g fill="currentColor" stroke="none">
      <rect x="8" y="14" width="3.4" height="14" rx="0.6" />
      <rect x="13.7" y="14" width="3.4" height="14" rx="0.6" />
      <rect x="25.2" y="14" width="3.4" height="14" rx="0.6" />
      <rect x="30.9" y="14" width="3.4" height="14" rx="0.6" />
      <rect x="36.6" y="14" width="3.4" height="14" rx="0.6" />
    </g>
  </>,
  organ: <>
    <g fill="var(--instrument-accent)" fillOpacity="0.25">
      <rect x="6" y="22" width="5" height="18" rx="2.5" />
      <rect x="14" y="14" width="5" height="26" rx="2.5" />
      <rect x="22" y="8" width="5" height="32" rx="2.5" />
      <rect x="30" y="14" width="5" height="26" rx="2.5" />
      <rect x="38" y="22" width="5" height="18" rx="2.5" />
    </g>
    <path d="M7 34h3M15 34h3M23 34h3M31 34h3M39 34h3" />
    <rect x="4" y="40" width="41" height="4" rx="1" />
  </>,
  strings: <>
    <path d="M24 16V5" />
    <circle cx="24" cy="4" r="1.5" />
    <path d="M24 16c-5 0-8 2-8 6 0 3 2 4 2 6 0 2-4 3-4 8 0 5 5 8 10 8s10-3 10-8-4-6-4-8 2-3 2-6c0-4-3-6-8-6z"
      fill="var(--instrument-accent)" fillOpacity="0.25" />
    <path d="M20 30c-1 2 1 4 0 6M28 30c1 2-1 4 0 6" strokeWidth="1.2" />
    <path d="M6 12l36 28" strokeOpacity="0.6" strokeWidth="1.5" />
  </>,
  brass: <>
    <path d="M34 20c5 0 8-4 10-8v24c-2-4-5-12-10-12z" fill="var(--instrument-accent)" fillOpacity="0.3" />
    <path d="M4 20v4M4 22h30M16 22v7a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-7M17 12h4M22 12h4M27 12h4" />
    <rect x="17.5" y="14" width="3" height="8" rx="1" />
    <rect x="22.5" y="14" width="3" height="8" rx="1" />
    <rect x="27.5" y="14" width="3" height="8" rx="1" />
  </>,
  bell: <>
    <circle cx="24" cy="7" r="2" />
    <path d="M10 36c4-2 4-6 4-10 0-10 4-16 10-16s10 6 10 16c0 4 0 8 4 10z"
      fill="var(--instrument-accent)" fillOpacity="0.25" />
    <circle cx="24" cy="39.5" r="2.5" />
    <path d="M7 14c-2 3-2 7 0 10M41 14c2 3 2 7 0 10" strokeOpacity="0.6" />
  </>,
  poly: <>
    <rect x="3" y="12" width="42" height="24" rx="3" />
    <circle cx="10" cy="19" r="2.5" />
    <circle cx="17" cy="19" r="2.5" />
    <circle cx="24" cy="19" r="2.5" />
    <rect x="30" y="16" width="11" height="6" rx="1" fill="var(--instrument-accent)" fillOpacity="0.5" />
    <rect x="6" y="26" width="36" height="7" rx="1" />
    <path d="M10.5 26v7M15 26v7M19.5 26v7M24 26v7M28.5 26v7M33 26v7M37.5 26v7" strokeWidth="1" />
  </>,
  fx: <>
    <path d="M4 24h6l4-12 6 24 6-18 4 10 4-4h10" stroke="var(--instrument-accent)" strokeWidth="2.5" />
  </>
};

// Instruments that share a family with an older one get their own drawing, so the picker and
// device panel tell them apart (the family accent colour stays).
const DEVICE_ARTWORK: Record<string, React.ReactNode> = {
  // Three detuned saws, stacked and offset.
  "synaptix-supersaw": <>
    <path d="M4 18L12 8v10l8-10v10l8-10v10l8-10v10l8-10" strokeOpacity="0.4" />
    <path d="M4 28L12 18v10l8-10v10l8-10v10l8-10v10l8-10" strokeOpacity="0.7" />
    <path d="M4 38L12 28v10l8-10v10l8-10v10l8-10v10l8-10" stroke="var(--instrument-accent)" strokeWidth="2.5" />
  </>,
  // Layered saws spreading left and right.
  "synaptix-unison": <>
    <path d="M10 22l6-8v8l6-8v8l6-8v8l6-8v8" strokeOpacity="0.5" />
    <path d="M10 30l6-8v8l6-8v8l6-8v8l6-8v8" stroke="var(--instrument-accent)" strokeWidth="2.5" />
    <path d="M4 40h40M4 40l4-3M4 40l4 3M44 40l-4-3M44 40l-4 3" strokeOpacity="0.7" />
  </>,
  // An acoustic guitar, upright: headstock, neck, figure-eight body, sound hole.
  "synaptix-guitar": <>
    <rect x="20.5" y="2" width="7" height="6" rx="1.5" />
    <path d="M22 8h4v13h-4z" />
    <path d="M24 21c-6 0-9 3-9 7 0 2 1 3 1 4-3 1-6 3.5-6 7 0 4.5 6 7 14 7s14-2.5 14-7c0-3.5-3-6-6-7 0-1 1-2 1-4 0-4-3-7-9-7z"
      fill="var(--instrument-accent)" fillOpacity="0.25" />
    <circle cx="24" cy="32" r="3.5" />
    <path d="M20 40h8" />
  </>,
  // A bell with a modulating sine inside it.
  "synaptix-fm-glass": <>
    <circle cx="24" cy="7" r="2" />
    <path d="M10 36c4-2 4-6 4-10 0-10 4-16 10-16s10 6 10 16c0 4 0 8 4 10z"
      fill="var(--instrument-accent)" fillOpacity="0.2" />
    <path d="M15 25q2.25-5 4.5 0t4.5 0 4.5 0 4.5 0" stroke="var(--instrument-accent)" strokeWidth="2" />
    <circle cx="24" cy="39.5" r="2.5" />
  </>,
  // Keys with a modulating sine above them.
  "synaptix-fm-ep": <>
    <path d="M6 12q4.5-7 9 0t9 0 9 0 9 0" stroke="var(--instrument-accent)" strokeWidth="2.5" />
    <rect x="4" y="20" width="40" height="20" rx="2" />
    <path d="M9.7 20v20M15.4 20v20M21.1 20v20M26.9 20v20M32.6 20v20M38.3 20v20" strokeWidth="1.2" />
    <g fill="currentColor" stroke="none">
      <rect x="8" y="20" width="3.4" height="11" rx="0.6" />
      <rect x="13.7" y="20" width="3.4" height="11" rx="0.6" />
      <rect x="25.2" y="20" width="3.4" height="11" rx="0.6" />
      <rect x="30.9" y="20" width="3.4" height="11" rx="0.6" />
      <rect x="36.6" y="20" width="3.4" height="11" rx="0.6" />
    </g>
  </>,
  // A kit: kick drum from the front, a snare, and a cymbal on its stand.
  "synaptix-beat-kit": <>
    <path d="M34 8l12 2M40 9v31M36 44l4-4 4 4" />
    <circle cx="20" cy="31" r="11" fill="var(--instrument-accent)" fillOpacity="0.25" />
    <circle cx="20" cy="31" r="4" />
    <ellipse cx="9" cy="14" rx="7" ry="2.5" />
    <path d="M2 14v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5" />
  </>,
  // A speaker cone thumping out, labelled 808.
  "synaptix-boom": <>
    <circle cx="20" cy="24" r="14" fill="var(--instrument-accent)" fillOpacity="0.2" />
    <circle cx="20" cy="24" r="6" fill="var(--instrument-accent)" fillOpacity="0.55" />
    <path d="M38 14c3 3 3 17 0 20M43 10c5 5 5 23 0 28" strokeOpacity="0.7" />
    <text x="20" y="46" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor" stroke="none"
      fontFamily="system-ui, sans-serif">808</text>
  </>,
  // A game controller with a pixel pulse wave above it.
  "synaptix-chiptune": <>
    <path d="M4 14h6V6h6v8h6V6h6v8h6V6h6v8" stroke="var(--instrument-accent)" strokeWidth="2.5" strokeLinecap="square" strokeLinejoin="miter" />
    <path d="M12 22h24c5 0 8 4 8 9s-3 9-6 9c-4 0-5-5-9-5H19c-4 0-5 5-9 5-3 0-6-4-6-9s3-9 8-9z"
      fill="var(--instrument-accent)" fillOpacity="0.2" />
    <path d="M12 28v6M9 31h6" />
    <circle cx="33" cy="29" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="37" cy="33" r="1.6" fill="currentColor" stroke="none" />
  </>,
  // A filter curve with a resonant peak, swept down.
  "synaptix-squelch": <>
    <path d="M4 40h40M4 8v32" strokeOpacity="0.35" />
    <path d="M4 26h16c4 0 5-16 8-16s4 10 6 18 4 12 10 12" stroke="var(--instrument-accent)" strokeWidth="2.5"
      fill="var(--instrument-accent)" fillOpacity="0.15" />
    <path d="M38 6l-8 0M30 6l3-3M30 6l3 3" strokeOpacity="0.8" />
  </>,
  // A slow wave circled by motion arrows.
  "synaptix-motion": <>
    <path d="M8 24q4-8 8 0t8 0 8 0 8 0" stroke="var(--instrument-accent)" strokeWidth="2.5" />
    <path d="M10 12a17 17 0 0 1 28 0M38 36a17 17 0 0 1-28 0" strokeOpacity="0.7" />
    <path d="M38 12l-5-1M38 12l1-5M10 36l5 1M10 36l-1 5" strokeOpacity="0.7" />
  </>
};

// Slice 3 instruments.
const SLICE_3_ARTWORK: Record<string, React.ReactNode> = {
  // A wave whose height wobbles.
  "synaptix-wobble": <>
    <path d="M4 24c2-10 4-10 6 0s4 10 6 0 3-4 4 0 3 4 4 0 4-10 6 0 4 10 6 0 4-10 6 0"
      stroke="var(--instrument-accent)" strokeWidth="2.5" />
    <path d="M4 10c6 0 8 8 20 8s14-8 20-8M4 38c6 0 8-8 20-8s14 8 20 8" strokeOpacity="0.45" strokeDasharray="2 3" />
  </>,
  // Two saws drifting against each other, low and dark.
  "synaptix-reese": <>
    <path d="M4 34L14 20v14l10-14v14l10-14v14l10-14" strokeOpacity="0.5" />
    <path d="M6 36L16 22v14l10-14v14l10-14v14l8-11" stroke="var(--instrument-accent)" strokeWidth="2.5" />
    <path d="M4 10h40" strokeOpacity="0.3" />
    <path d="M10 14q4-6 8 0t8 0 8 0 8 0" strokeOpacity="0.6" />
  </>,
  // Three violin necks side by side, with a vibrato line.
  "synaptix-ensemble": <>
    <path d="M12 6v30M24 4v32M36 6v30" />
    <ellipse cx="12" cy="38" rx="5" ry="6" fill="var(--instrument-accent)" fillOpacity="0.25" />
    <ellipse cx="24" cy="38" rx="5" ry="6" fill="var(--instrument-accent)" fillOpacity="0.35" />
    <ellipse cx="36" cy="38" rx="5" ry="6" fill="var(--instrument-accent)" fillOpacity="0.25" />
    <path d="M4 20q3-4 6 0t6 0 6 0 6 0 6 0 6 0 6 0" stroke="var(--instrument-accent)" strokeWidth="1.8" />
  </>,
  // Noise swelling upwards into an arrow.
  "synaptix-riser": <>
    <path d="M4 40c10 0 18-4 24-14s10-18 16-22" stroke="var(--instrument-accent)" strokeWidth="2.5" />
    <path d="M44 4l-7 1M44 4l-1 7" stroke="var(--instrument-accent)" strokeWidth="2.5" />
    <path d="M6 38v-3M10 37v-5M14 36v-7M18 34v-9M22 31v-11M26 27v-13" strokeOpacity="0.5" strokeWidth="1.5" />
  </>,
  // A noise burst falling away, with an impact mark.
  "synaptix-downsweep": <>
    <path d="M4 6c6 4 10 12 16 22s14 14 24 14" stroke="var(--instrument-accent)" strokeWidth="2.5" />
    <path d="M44 42l-7-3M44 42l-4 6" stroke="var(--instrument-accent)" strokeWidth="2.5" />
    <path d="M8 4l2 3M3 10l3 1M13 3l-1 3" strokeOpacity="0.7" />
    <path d="M18 24v4M22 28v5M26 31v5M30 34v5" strokeOpacity="0.5" strokeWidth="1.5" />
  </>,
  // A sharp stab: instant attack, fast decay, with sparks.
  "synaptix-uplift": <>
    <path d="M4 40h40" strokeOpacity="0.35" />
    <path d="M8 40V10c3 14 8 24 30 30" stroke="var(--instrument-accent)" strokeWidth="2.5"
      fill="var(--instrument-accent)" fillOpacity="0.15" />
    <path d="M30 8l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="currentColor" stroke="none" />
    <path d="M40 18l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" fill="currentColor" stroke="none" />
  </>,
  // Wooden bars getting shorter, with a mallet striking one.
  "synaptix-marimba": <>
    <rect x="4" y="18" width="7" height="24" rx="1.5" fill="var(--instrument-accent)" fillOpacity="0.3" />
    <rect x="14" y="20" width="7" height="20" rx="1.5" fill="var(--instrument-accent)" fillOpacity="0.3" />
    <rect x="24" y="22" width="7" height="16" rx="1.5" fill="var(--instrument-accent)" fillOpacity="0.3" />
    <rect x="34" y="24" width="7" height="12" rx="1.5" fill="var(--instrument-accent)" fillOpacity="0.3" />
    <path d="M30 4l-11 13" strokeWidth="2" />
    <circle cx="31.5" cy="3.5" r="3" fill="currentColor" stroke="none" />
  </>,
  // Metal bars with a tremolo wave over them.
  "synaptix-vibes": <>
    <path d="M4 10q3-5 6 0t6 0 6 0 6 0 6 0 6 0 6 0" stroke="var(--instrument-accent)" strokeWidth="2.5" />
    <rect x="4" y="20" width="7" height="22" rx="1.5" />
    <rect x="14" y="21" width="7" height="20" rx="1.5" />
    <rect x="24" y="22" width="7" height="18" rx="1.5" />
    <rect x="34" y="23" width="7" height="16" rx="1.5" />
    <path d="M4 31h37" stroke="var(--instrument-accent)" strokeOpacity="0.6" />
  </>
};

interface InstrumentIconProps {
  kind: InstrumentProfileKind;
  /** Picks a dedicated drawing when the instrument has one; otherwise the family's. */
  deviceType?: string;
  size?: number;
}

export function InstrumentIcon({ kind, deviceType, size = 36 }: InstrumentIconProps) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ "--instrument-accent": INSTRUMENT_ACCENTS[kind], flexShrink: 0 } as React.CSSProperties}>
      {(deviceType && (DEVICE_ARTWORK[deviceType] ?? SLICE_3_ARTWORK[deviceType])) ?? ARTWORK[kind]}
    </svg>
  );
}
