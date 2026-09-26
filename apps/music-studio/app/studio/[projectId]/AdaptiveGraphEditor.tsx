"use client";
import type { AdaptiveGameAudioManifest, AdaptiveTransition } from "@synaptix/render-contracts";
import type { AdaptiveStateDraft } from "../../../lib/platform/adaptive-authoring-model";
import { Button } from "../../../components/ui/StudioControls";

export type AdaptiveConfiguration = Pick<AdaptiveGameAudioManifest, "transitions" | "cuePoints">;
export function AdaptiveGraphEditor({
  states,
  value,
  onChange
}: {
  states: AdaptiveStateDraft[];
  value: AdaptiveConfiguration;
  onChange(value: AdaptiveConfiguration): void;
}) {
  const update = (index: number, patch: Partial<AdaptiveTransition>) =>
    onChange({
      ...value,
      transitions: value.transitions.map((item, candidate) =>
        candidate === index ? { ...item, ...patch } : item
      )
    });
  return (
    <section aria-label="Transitions and cues" className="adaptive-state-card">
      <h3>State intensity & transitions</h3>
      <ul className="intensity-map" aria-label="State intensity map">
        {states.map((state) => (
          <li key={state.stateId}>
            <strong>{state.displayName}</strong>
            <meter
              min={0}
              max={1}
              value={state.intensity}
              aria-label={`${state.displayName} intensity`}
            />
            {Math.round(state.intensity * 100)}%
          </li>
        ))}
      </ul>
      <div
        className="transition-graph"
        role="img"
        aria-label={
          value.transitions.length
            ? value.transitions
                .map((item) => `${item.fromStateId} to ${item.toStateId}, ${item.trigger}`)
                .join("; ")
            : "No transitions configured"
        }
      >
        {value.transitions.map((item) => (
          <p key={item.transitionId}>
            {item.fromStateId} → <span>{item.trigger}</span> → {item.toStateId}
          </p>
        ))}
      </div>
      {value.transitions.map((item, index) => (
        <fieldset key={item.transitionId}>
          <legend>Transition {index + 1}</legend>
          <label>
            From state
            <select
              value={item.fromStateId}
              onChange={(event) =>
                update(index, { fromStateId: event.target.value, cuePointId: null })
              }
            >
              {states.map((state) => (
                <option key={state.stateId} value={state.stateId}>
                  {state.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            To state
            <select
              value={item.toStateId}
              onChange={(event) => update(index, { toStateId: event.target.value })}
            >
              {states.map((state) => (
                <option key={state.stateId} value={state.stateId}>
                  {state.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Trigger
            <select
              value={item.trigger}
              onChange={(event) =>
                update(index, { trigger: event.target.value as AdaptiveTransition["trigger"] })
              }
            >
              {["immediate", "next-beat", "next-bar", "next-phrase", "cue-point"].map((trigger) => (
                <option key={trigger}>{trigger}</option>
              ))}
            </select>
          </label>
          {item.trigger === "cue-point" && (
            <label>
              Source cue
              <select
                value={item.cuePointId ?? ""}
                onChange={(event) => update(index, { cuePointId: event.target.value || null })}
              >
                <option value="">Select cue</option>
                {value.cuePoints
                  .filter((cue) => cue.stateId === item.fromStateId)
                  .map((cue) => (
                    <option key={cue.cuePointId}>{cue.cuePointId}</option>
                  ))}
              </select>
            </label>
          )}
          <label>
            Crossfade milliseconds
            <input
              type="number"
              min={0}
              max={30000}
              value={item.crossfadeMilliseconds}
              onChange={(event) =>
                update(index, { crossfadeMilliseconds: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Minimum source playback seconds
            <input
              type="number"
              min={0}
              step={0.1}
              value={item.minimumSourcePlaybackSeconds}
              onChange={(event) =>
                update(index, { minimumSourcePlaybackSeconds: Number(event.target.value) })
              }
            />
          </label>
          <Button
            onClick={() =>
              onChange({
                ...value,
                transitions: value.transitions.filter((_, candidate) => candidate !== index)
              })
            }
          >
            Remove transition {index + 1}
          </Button>
        </fieldset>
      ))}
      <Button
        disabled={states.length < 2}
        onClick={() =>
          onChange({
            ...value,
            transitions: [
              ...value.transitions,
              {
                transitionId: crypto.randomUUID(),
                fromStateId: states[0]!.stateId,
                toStateId: states[1]!.stateId,
                trigger: "next-bar",
                crossfadeMilliseconds: 500,
                cuePointId: null,
                minimumSourcePlaybackSeconds: 0
              }
            ]
          })
        }
      >
        Add transition
      </Button>
      <h3>Cue points</h3>
      {value.cuePoints.map((cue, index) => (
        <fieldset key={index}>
          <legend>Cue {index + 1}</legend>
          <label>
            Cue ID
            <input
              value={cue.cuePointId}
              onChange={(event) =>
                onChange({
                  ...value,
                  cuePoints: value.cuePoints.map((item, candidate) =>
                    candidate === index ? { ...item, cuePointId: event.target.value } : item
                  ),
                  transitions: value.transitions.map((item) =>
                    item.cuePointId === cue.cuePointId
                      ? { ...item, cuePointId: event.target.value }
                      : item
                  )
                })
              }
            />
          </label>
          <label>
            Cue state
            <select
              value={cue.stateId}
              onChange={(event) =>
                onChange({
                  ...value,
                  cuePoints: value.cuePoints.map((item, candidate) =>
                    candidate === index ? { ...item, stateId: event.target.value } : item
                  )
                })
              }
            >
              {states.map((state) => (
                <option key={state.stateId} value={state.stateId}>
                  {state.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cue seconds
            <input
              type="number"
              min={0}
              step={0.1}
              value={cue.positionSeconds}
              onChange={(event) =>
                onChange({
                  ...value,
                  cuePoints: value.cuePoints.map((item, candidate) =>
                    candidate === index
                      ? { ...item, positionSeconds: Number(event.target.value) }
                      : item
                  )
                })
              }
            />
          </label>
          <label>
            Semantic
            <select
              value={cue.semantic}
              onChange={(event) =>
                onChange({
                  ...value,
                  cuePoints: value.cuePoints.map((item, candidate) =>
                    candidate === index
                      ? { ...item, semantic: event.target.value as typeof cue.semantic }
                      : item
                  )
                })
              }
            >
              {["entry", "exit", "impact", "loop", "custom"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <Button
            onClick={() =>
              onChange({
                ...value,
                cuePoints: value.cuePoints.filter((_, candidate) => candidate !== index),
                transitions: value.transitions.map((item) =>
                  item.cuePointId === cue.cuePointId ? { ...item, cuePointId: null } : item
                )
              })
            }
          >
            Remove cue {index + 1}
          </Button>
        </fieldset>
      ))}
      <Button
        disabled={!states.length}
        onClick={() =>
          onChange({
            ...value,
            cuePoints: [
              ...value.cuePoints,
              {
                cuePointId: crypto.randomUUID(),
                stateId: states[0]!.stateId,
                positionSeconds: 0,
                semantic: "custom"
              }
            ]
          })
        }
      >
        Add cue
      </Button>
    </section>
  );
}
