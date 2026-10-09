"use client";

import { useRef } from "react";

import { INSTRUMENT_CATALOG } from "@synaptix/daw-engine";

import { InstrumentIcon, INSTRUMENT_ACCENTS } from "./InstrumentIcon";

const SIDEBAR_COUNT = 6;

type Entry = (typeof INSTRUMENT_CATALOG)[number];

/** The sidebar's six instruments; a choice made in the full list takes the last spot. */
export function featuredInstruments(selected: string): Entry[] {
  const featured = INSTRUMENT_CATALOG.slice(0, SIDEBAR_COUNT);
  if (featured.some((entry) => entry.deviceType === selected)) return featured;
  const chosen = INSTRUMENT_CATALOG.find((entry) => entry.deviceType === selected);
  return chosen ? [...featured.slice(0, SIDEBAR_COUNT - 1), chosen] : featured;
}

function InstrumentTile({ entry, name, selected, onSelect, showDescription = false }: {
  entry: Entry;
  name: string;
  selected: boolean;
  onSelect(deviceType: string): void;
  showDescription?: boolean;
}) {
  return (
    <label className="instrument-tile" title={entry.description}
      style={{ "--instrument-accent": INSTRUMENT_ACCENTS[entry.profile.kind] } as React.CSSProperties}>
      <input type="radio" name={name} value={entry.deviceType} checked={selected}
        onChange={() => onSelect(entry.deviceType)} />
      <InstrumentIcon kind={entry.profile.kind} deviceType={entry.deviceType} size={32} />
      <span>{entry.label}</span>
      {showDescription && <small>{entry.description}</small>}
    </label>
  );
}

export function InstrumentPicker({ value, onChange }: { value: string; onChange(deviceType: string): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <fieldset className="instrument-picker" aria-label="Choose an instrument">
        {featuredInstruments(value).map((entry) => (
          <InstrumentTile key={entry.deviceType} entry={entry} name="new-instrument"
            selected={value === entry.deviceType} onSelect={onChange} />
        ))}
      </fieldset>
      <button type="button" className="instrument-browse" aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}>
        All instruments ({INSTRUMENT_CATALOG.length})
      </button>

      <dialog ref={dialogRef} className="instrument-dialog" aria-labelledby="instrument-dialog-heading"
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        <div className="instrument-dialog-body">
          <header>
            <h2 id="instrument-dialog-heading">Choose an instrument</h2>
            <button type="button" aria-label="Close" onClick={() => dialogRef.current?.close()}>✕</button>
          </header>
          <fieldset className="instrument-picker instrument-picker-all" aria-label="All instruments">
            {INSTRUMENT_CATALOG.map((entry) => (
              <InstrumentTile key={entry.deviceType} entry={entry} name="new-instrument-all" showDescription
                selected={value === entry.deviceType}
                onSelect={(deviceType) => { onChange(deviceType); dialogRef.current?.close(); }} />
            ))}
          </fieldset>
        </div>
      </dialog>
    </>
  );
}
