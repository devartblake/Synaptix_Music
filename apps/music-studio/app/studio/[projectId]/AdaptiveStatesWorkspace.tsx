"use client";

import { Button } from "../../../components/ui/StudioControls";

import { useEffect, useMemo, useState } from "react";

import {
  RenderJobSchema,
  AdaptiveDeviceParameterMappingSchema,
  AdaptiveCuePointSchema,
  type AdaptiveDeviceParameterMapping,
  type RenderJob
} from "@synaptix/render-contracts";
import { FREQUENCY_DRONE_DEVICE_TYPE, DEVICE_PARAMETER_DEFINITIONS } from "@synaptix/daw-engine";
import type { MusicProject } from "@synaptix/project-model";
import { z } from "zod";
import { AdaptiveGraphEditor, type AdaptiveConfiguration } from "./AdaptiveGraphEditor";
import { AdaptivePreviewPanel } from "./AdaptivePreviewPanel";
import { AdaptivePublication } from "./AdaptivePublication";

import {
  buildAdaptiveDraft,
  eligibleAdaptiveRenders,
  type AdaptiveStateDraft,
  ADAPTIVE_STINGER_CUES,
  adaptiveStateRole,
  tagsForAdaptiveRole,
  type AdaptiveStingerCue
} from "../../../lib/platform/adaptive-authoring-model";

const RenderJobListSchema = z.object({ jobs: z.array(RenderJobSchema) });
const DraftSchema = z.object({
  packageId: z.string().uuid(),
  states: z.array(
    z.object({
      jobId: z.string(),
      stateId: z.string(),
      displayName: z.string(),
      intensity: z.number(),
      tags: z.array(z.string()),
      loopStartSeconds: z.number().optional(),
      loopEndSeconds: z.number().optional(),
      entryCueSeconds: z.number().optional(),
      exitCueSeconds: z.number().nullable().optional()
    })
  ),
  configuration: z.object({
    transitions: z.array(
      z.object({
        transitionId: z.string(),
        fromStateId: z.string(),
        toStateId: z.string(),
        trigger: z.enum(["immediate", "next-beat", "next-bar", "next-phrase", "cue-point"]),
        crossfadeMilliseconds: z.number(),
        cuePointId: z.string().nullable(),
        minimumSourcePlaybackSeconds: z.number()
      })
    ),
    cuePoints: z.array(AdaptiveCuePointSchema)
  }),
  createdAt: z.string().datetime().optional(),
  deviceMappings: z.array(AdaptiveDeviceParameterMappingSchema)
});

export function AdaptiveStatesWorkspace({
  project,
  onClose
}: {
  project: MusicProject;
  onClose(): void;
}) {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [states, setStates] = useState<AdaptiveStateDraft[]>([]);
  const [deviceMappings, setDeviceMappings] = useState<AdaptiveDeviceParameterMapping[]>([]);
  const [packageId, setPackageId] = useState<string>(() => crypto.randomUUID());
  const [configuration, setConfiguration] = useState<AdaptiveConfiguration>({
    transitions: [],
    cuePoints: []
  });
  const [loaded, setLoaded] = useState(false);
  const [createdAt, setCreatedAt] = useState(() => new Date().toISOString());
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [draftStatus, setDraftStatus] = useState("");
  const [refresh, setRefresh] = useState(0);
  const draftKey = `synaptix-music:adaptive:v1:${project.projectId}`;
  const [message, setMessage] = useState("Loading completed renders…");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = DraftSchema.parse(JSON.parse(raw));
        setPackageId(draft.packageId);
        setStates(draft.states);
        setConfiguration(draft.configuration);
        setDeviceMappings(draft.deviceMappings);
        if (draft.createdAt) setCreatedAt(draft.createdAt);
      }
    } catch {
      setStorageBlocked(true);
      setDraftStatus(
        "Saved draft could not be loaded. The stored copy is preserved; changes cannot be saved until it is recovered."
      );
    }
    setLoaded(true);
  }, [draftKey]);
  useEffect(() => {
    if (!loaded || storageBlocked) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ packageId, states, configuration, deviceMappings, createdAt })
      );
      setDraftStatus(
        "Draft saved in this browser. Certification files must be reverified after reopening."
      );
    } catch {
      setDraftStatus(
        "Draft could not be saved. Keep this workspace open until browser storage is available."
      );
    }
  }, [
    loaded,
    storageBlocked,
    draftKey,
    packageId,
    states,
    configuration,
    deviceMappings,
    createdAt
  ]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/platform/render-jobs?status=completed", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Completed renders are unavailable.");
        return RenderJobListSchema.parse(await response.json()).jobs;
      })
      .then((values) => {
        setJobs(values);
        setMessage("Select certified render candidates for each adaptive state.");
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setMessage(reason instanceof Error ? reason.message : "Render recovery failed.");
      });
    return () => controller.abort();
  }, [refresh]);

  const eligible = useMemo(
    () => eligibleAdaptiveRenders(jobs, project.projectId),
    [jobs, project.projectId]
  );
  // The project's musical grid, published with the package so game runtimes
  // quantize transitions on the same beats the preview uses.
  const tempo = project.tempoMap[0]?.bpm ?? 120;
  const numerator = project.timeSignatureMap[0]?.numerator ?? 4;
  const denominator = project.timeSignatureMap[0]?.denominator ?? 4;
  const clock = useMemo(
    () => ({ beatsPerMinute: (tempo * denominator) / 4, beatsPerBar: numerator, barsPerPhrase: 4 }),
    [tempo, numerator, denominator]
  );
  const validation = useMemo(() => {
    try {
      return {
        manifest: states.length
          ? buildAdaptiveDraft(packageId, project.projectId, states, jobs, configuration, createdAt, clock)
          : null,
        error: null
      };
    } catch (cause) {
      return { manifest: null, error: cause instanceof Error ? cause.message : "Invalid draft." };
    }
  }, [jobs, packageId, project.projectId, states, configuration, createdAt, clock]);
  const manifest = validation.manifest;

  function addState(job: RenderJob): void {
    const index = states.length + 1;
    setStates((current) => [
      ...current,
      {
        jobId: job.jobId,
        stateId: `state-${crypto.randomUUID().slice(0, 8)}`,
        displayName: `Adaptive state ${index}`,
        intensity: Math.min(1, index * 0.25),
        tags: ["gameplay"],
        loopStartSeconds: 0,
        loopEndSeconds: job.result!.artifacts.find(
          (artifact) =>
            artifact.trackId === null &&
            artifact.mediaType.startsWith("audio/") &&
            !artifact.fileName.startsWith("preview.")
        )!.durationSeconds,
        entryCueSeconds: 0,
        exitCueSeconds: null
      }
    ]);
  }

  const droneDevices = useMemo(
    () =>
      project.tracks.flatMap((track) =>
        track.devices
          .filter((device) => device.deviceType === FREQUENCY_DRONE_DEVICE_TYPE)
          .map((device) => ({ track, device }))
      ),
    [project]
  );

  function addDeviceMapping(
    stateId: string,
    trackId: string,
    deviceId: string,
    parameterId: string,
    value: number
  ): void {
    const definition = DEVICE_PARAMETER_DEFINITIONS.find((item) => item.id === parameterId);
    if (
      !definition ||
      !Number.isFinite(value) ||
      value < definition.minimum ||
      value > definition.maximum
    ) {
      setMessage("Mapping value must be within the selected device parameter range.");
      return;
    }
    setDeviceMappings((current) => [
      ...current.filter(
        (item) =>
          !(
            item.stateId === stateId &&
            item.deviceId === deviceId &&
            item.parameterId === parameterId
          )
      ),
      { mappingId: crypto.randomUUID(), stateId, trackId, deviceId, parameterId, value }
    ]);
  }

  function updateState(index: number, patch: Partial<AdaptiveStateDraft>): void {
    const previous = states[index]!.stateId;
    if (patch.stateId !== undefined) {
      const next = patch.stateId;
      setConfiguration((current) => ({
        transitions: current.transitions.map((item) => ({
          ...item,
          fromStateId: item.fromStateId === previous ? next : item.fromStateId,
          toStateId: item.toStateId === previous ? next : item.toStateId
        })),
        cuePoints: current.cuePoints.map((item) =>
          item.stateId === previous ? { ...item, stateId: next } : item
        )
      }));
      setDeviceMappings((current) =>
        current.map((item) => (item.stateId === previous ? { ...item, stateId: next } : item))
      );
    }
    setStates((current) =>
      current.map((state, candidate) => (candidate === index ? { ...state, ...patch } : state))
    );
  }

  return (
    <section className="adaptive-workspace" aria-label="Adaptive States authoring workspace">
      <header className="generation-header">
        <div>
          <span className="eyebrow">SynaptixPlay adaptive audio</span>
          <h2>Author adaptive states</h2>
          <p>Compose runtime states from immutable completed render candidates.</p>
        </div>
        <Button onClick={onClose}>Back to arrangement</Button>
      </header>
      <div className="adaptive-authoring-grid">
        <section className="adaptive-candidates" aria-labelledby="render-candidates-title">
          <h3 id="render-candidates-title">Render candidates</h3>
          <p role="status">{message}</p>
          <Button onClick={() => setRefresh((value) => value + 1)}>Refresh renders</Button>
          {eligible.length === 0 ? (
            <div className="preview-empty">
              <strong>No eligible master renders</strong>
              <p>Complete a master render for this project before authoring a state.</p>
            </div>
          ) : (
            eligible.map((job) => (
              <article className="adaptive-render-card" key={job.jobId}>
                <div>
                  <strong>{job.manifest.revisionId}</strong>
                  <small>
                    {job.result?.artifacts.length} artifacts ·{" "}
                    {job.manifest.output.format.toUpperCase()}
                  </small>
                </div>
                <Button
                  onClick={() => addState(job)}
                  disabled={states.some((state) => state.jobId === job.jobId)}
                >
                  Add state
                </Button>
              </article>
            ))
          )}
        </section>
        <section className="adaptive-state-editor" aria-labelledby="adaptive-states-title">
          <h3 id="adaptive-states-title">Package states</h3>
          <p role="status">{draftStatus}</p>
          {states.map((state, index) => (
            <fieldset className="adaptive-state-card" key={state.jobId}>
              <legend>State {index + 1}</legend>
              <label>
                Name
                <input
                  value={state.displayName}
                  onChange={(event) => updateState(index, { displayName: event.target.value })}
                />
              </label>
              <label>
                State ID
                <input
                  value={state.stateId}
                  onChange={(event) => updateState(index, { stateId: event.target.value })}
                />
              </label>
              <label>
                Role
                <select
                  value={(() => {
                    const role = adaptiveStateRole(state.tags);
                    return role.kind === "music" ? "music" : `stinger:${role.cue}`;
                  })()}
                  onChange={(event) => {
                    const value = event.target.value;
                    const role =
                      value === "music"
                        ? ({ kind: "music" } as const)
                        : ({ kind: "stinger", cue: value.slice("stinger:".length) as AdaptiveStingerCue } as const);
                    if (role.kind === "stinger")
                      // One-shots never take part in the transition graph.
                      setConfiguration((current) => ({
                        ...current,
                        transitions: current.transitions.filter(
                          (item) => item.fromStateId !== state.stateId && item.toStateId !== state.stateId
                        )
                      }));
                    updateState(index, { tags: tagsForAdaptiveRole(role, state.tags) });
                  }}
                >
                  <option value="music">Music state (loops, transitions)</option>
                  {ADAPTIVE_STINGER_CUES.map((item) => (
                    <option key={item.cue} value={`stinger:${item.cue}`}>
                      Stinger: {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Intensity <span>{Math.round(state.intensity * 100)}%</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={state.intensity}
                  onChange={(event) =>
                    updateState(index, { intensity: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Loop start seconds
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={state.loopStartSeconds ?? 0}
                  onChange={(event) =>
                    updateState(index, { loopStartSeconds: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Loop end seconds
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={state.loopEndSeconds ?? 0}
                  onChange={(event) =>
                    updateState(index, { loopEndSeconds: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Entry seconds
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={state.entryCueSeconds ?? 0}
                  onChange={(event) =>
                    updateState(index, { entryCueSeconds: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Exit seconds (optional)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={state.exitCueSeconds ?? ""}
                  onChange={(event) =>
                    updateState(index, {
                      exitCueSeconds: event.target.value === "" ? null : Number(event.target.value)
                    })
                  }
                />
              </label>
              <Button
                onClick={() => {
                  setStates((current) => current.filter((_, candidate) => candidate !== index));
                  setConfiguration((current) => ({
                    transitions: current.transitions.filter(
                      (item) =>
                        item.fromStateId !== state.stateId && item.toStateId !== state.stateId
                    ),
                    cuePoints: current.cuePoints.filter((item) => item.stateId !== state.stateId)
                  }));
                  setDeviceMappings((current) =>
                    current.filter((item) => item.stateId !== state.stateId)
                  );
                }}
              >
                Remove state
              </Button>
            </fieldset>
          ))}
          <AdaptiveGraphEditor
            states={states.filter((state) => adaptiveStateRole(state.tags).kind === "music")}
            value={configuration}
            onChange={setConfiguration}
          />
          {validation.error && <p role="alert">{validation.error}</p>}
          <AdaptivePreviewPanel
            manifest={manifest}
            jobs={jobs}
            clock={clock}
          />
          {droneDevices.length > 0 && (
            <section aria-labelledby="adaptive-device-mappings">
              <h3 id="adaptive-device-mappings">Adaptive device mappings</h3>
              <p>
                Map a persisted drone parameter to a target value when an adaptive state becomes
                active.
              </p>
              <p>
                Device mappings are draft annotations. The current audio-manifest contract publishes
                rendered states; live device mappings are not included in preview or publication.
              </p>
              {states.map((state) =>
                droneDevices.map(({ track, device }) => (
                  <div key={state.stateId + device.id} className="adaptive-state-card">
                    <strong>
                      {state.displayName} · {track.name}
                    </strong>
                    <select
                      aria-label="Drone parameter"
                      defaultValue="droneGain"
                      id={`parameter-${state.stateId}-${device.id}`}
                    >
                      {DEVICE_PARAMETER_DEFINITIONS.filter((definition) =>
                        definition.id.startsWith("drone")
                      ).map((definition) => (
                        <option key={definition.id} value={definition.id}>
                          {definition.label}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="Target value"
                      type="number"
                      defaultValue={0.12}
                      step={0.01}
                      id={`value-${state.stateId}-${device.id}`}
                    />
                    <Button
                      onClick={() => {
                        const parameter = (
                          document.getElementById(
                            `parameter-${state.stateId}-${device.id}`
                          ) as HTMLSelectElement
                        ).value;
                        const value = Number(
                          (
                            document.getElementById(
                              `value-${state.stateId}-${device.id}`
                            ) as HTMLInputElement
                          ).value
                        );
                        addDeviceMapping(state.stateId, track.id, device.id, parameter, value);
                      }}
                    >
                      Add mapping
                    </Button>
                  </div>
                ))
              )}
              {deviceMappings.length > 0 && (
                <details>
                  <summary>{deviceMappings.length} device mappings</summary>
                  <pre tabIndex={0} aria-label="Device mappings JSON">
                    {JSON.stringify(deviceMappings, null, 2)}
                  </pre>
                </details>
              )}
            </section>
          )}
          {manifest && (
            <details className="adaptive-manifest">
              <summary>Preview validated package manifest</summary>
              <pre tabIndex={0} aria-label="Draft manifest JSON">
                {JSON.stringify(manifest, null, 2)}
              </pre>
            </details>
          )}
        </section>
        <AdaptivePublication manifest={manifest} jobs={jobs} packageId={packageId} />
      </div>
    </section>
  );
}
