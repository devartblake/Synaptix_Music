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
  poly: "#8994ff"
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
  </>
};

interface InstrumentIconProps {
  kind: InstrumentProfileKind;
  size?: number;
}

export function InstrumentIcon({ kind, size = 36 }: InstrumentIconProps) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ "--instrument-accent": INSTRUMENT_ACCENTS[kind], flexShrink: 0 } as React.CSSProperties}>
      {ARTWORK[kind]}
    </svg>
  );
}
