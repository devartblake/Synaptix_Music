"use client";

import { useEffect, useMemo, useState } from "react";

import { RenderJobSchema, type AdaptiveDeviceParameterMapping, type RenderJob } from "@synaptix/render-contracts";
import { FREQUENCY_DRONE_DEVICE_TYPE, DEVICE_PARAMETER_DEFINITIONS } from "@synaptix/daw-engine";
import type { MusicProject } from "@synaptix/project-model";
import { z } from "zod";

import {
  buildAdaptiveDraft,
  eligibleAdaptiveRenders,
  type AdaptiveStateDraft
} from "../../../lib/platform/adaptive-authoring-model";

const RenderJobListSchema = z.object({ jobs: z.array(RenderJobSchema) });

export function AdaptiveStatesWorkspace({ project, onClose }: { project: MusicProject; onClose(): void }) {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [states, setStates] = useState<AdaptiveStateDraft[]>([]);
  const [deviceMappings, setDeviceMappings] = useState<AdaptiveDeviceParameterMapping[]>([]);
  const [packageId] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState("Loading completed renders…");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/platform/render-jobs?status=completed", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Completed renders are unavailable.");
        return RenderJobListSchema.parse(await response.json()).jobs;
      })
      .then((values) => {
        setJobs(values);
        setMessage("Select certified render candidates for each adaptive state.");
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setMessage(reason instanceof Error ? reason.message : "Render recovery failed.");
      });
    return () => controller.abort();
  }, []);

  const eligible = useMemo(() => eligibleAdaptiveRenders(jobs, project.projectId), [jobs, project.projectId]);
  const manifest = useMemo(() => {
    try { return states.length ? buildAdaptiveDraft(packageId, project.projectId, states, jobs) : null; }
    catch { return null; }
  }, [jobs, packageId, project.projectId, states]);

  function addState(job: RenderJob): void {
    const index = states.length + 1;
    setStates((current) => [...current, {
      jobId: job.jobId,
      stateId: `state-${index}`,
      displayName: `Adaptive state ${index}`,
      intensity: Math.min(1, index * 0.25),
      tags: ["gameplay"]
    }]);
  }

  const droneDevices = useMemo(() => project.tracks.flatMap((track) => track.devices.filter((device) => device.deviceType === FREQUENCY_DRONE_DEVICE_TYPE).map((device) => ({ track, device }))), [project]);

  function addDeviceMapping(stateId: string, trackId: string, deviceId: string, parameterId: string, value: number): void {
    setDeviceMappings((current) => [...current, { mappingId: crypto.randomUUID(), stateId, trackId, deviceId, parameterId, value }]);
  }

  function updateState(index: number, patch: Partial<AdaptiveStateDraft>): void {
    setStates((current) => current.map((state, candidate) => candidate === index ? { ...state, ...patch } : state));
  }

  return <section className="adaptive-workspace" aria-label="Adaptive States authoring workspace">
    <header className="generation-header">
      <div><span className="eyebrow">SynaptixPlay adaptive audio</span><h2>Author adaptive states</h2><p>Compose runtime states from immutable completed render candidates.</p></div>
      <button onClick={onClose}>Back to arrangement</button>
    </header>
    <div className="adaptive-authoring-grid">
      <section className="adaptive-candidates" aria-labelledby="render-candidates-title">
        <h3 id="render-candidates-title">Render candidates</h3><p>{message}</p>
        {eligible.length === 0 ? <div className="preview-empty"><strong>No eligible master renders</strong><p>Complete a master render for this project before authoring a state.</p></div> : eligible.map((job) => <article className="adaptive-render-card" key={job.jobId}>
          <div><strong>{job.manifest.revisionId}</strong><small>{job.result?.artifacts.length} artifacts · {job.manifest.output.format.toUpperCase()}</small></div>
          <button onClick={() => addState(job)} disabled={states.some((state) => state.jobId === job.jobId)}>Add state</button>
        </article>)}
      </section>
      <section className="adaptive-state-editor" aria-labelledby="adaptive-states-title">
        <h3 id="adaptive-states-title">Package states</h3>
        {states.map((state, index) => <fieldset className="adaptive-state-card" key={state.jobId}>
          <legend>State {index + 1}</legend>
          <label>Name<input value={state.displayName} onChange={(event) => updateState(index, { displayName: event.target.value })} /></label>
          <label>State ID<input value={state.stateId} onChange={(event) => updateState(index, { stateId: event.target.value })} /></label>
          <label>Intensity <output>{Math.round(state.intensity * 100)}%</output><input type="range" min="0" max="1" step="0.05" value={state.intensity} onChange={(event) => updateState(index, { intensity: Number(event.target.value) })} /></label>
          <button onClick={() => setStates((current) => current.filter((_, candidate) => candidate !== index))}>Remove state</button>
        </fieldset>)}
        {droneDevices.length > 0 && <section aria-labelledby="adaptive-device-mappings"><h3 id="adaptive-device-mappings">Adaptive device mappings</h3>
          <p>Map a persisted drone parameter to a target value when an adaptive state becomes active.</p>
          {states.map((state) => droneDevices.map(({track,device}) => <div key={state.stateId+device.id} className="adaptive-state-card">
            <strong>{state.displayName} · {track.name}</strong>
            <select aria-label="Drone parameter" defaultValue="droneGain" id={`parameter-${state.stateId}-${device.id}`}>
              {DEVICE_PARAMETER_DEFINITIONS.filter((definition) => definition.id.startsWith("drone")).map((definition) => <option key={definition.id} value={definition.id}>{definition.label}</option>)}
            </select>
            <input aria-label="Target value" type="number" defaultValue={0.12} step={0.01} id={`value-${state.stateId}-${device.id}`} />
            <button onClick={() => {
              const parameter = (document.getElementById(`parameter-${state.stateId}-${device.id}`) as HTMLSelectElement).value;
              const value = Number((document.getElementById(`value-${state.stateId}-${device.id}`) as HTMLInputElement).value);
              addDeviceMapping(state.stateId, track.id, device.id, parameter, value);
            }}>Add mapping</button>
          </div>))}
          {deviceMappings.length > 0 && <details><summary>{deviceMappings.length} device mappings</summary><pre>{JSON.stringify(deviceMappings, null, 2)}</pre></details>}
        </section>}
        {manifest && <details className="adaptive-manifest"><summary>Preview validated package manifest</summary><pre>{JSON.stringify(manifest, null, 2)}</pre></details>}
      </section>
      <aside className="certification-gate" aria-label="Publication certification gate">
        <span className="status-pill"><span className="status-dot warning" aria-hidden="true" />Publication locked</span>
        <h3>Stage 12 evidence required</h3>
        <p>This workspace can author and validate a draft. Publishing remains disabled until a passing staging certification report and matching artifact-manifest checksum are available.</p>
        <dl><div><dt>Draft manifest</dt><dd>{manifest ? "Valid" : "Incomplete"}</dd></div><div><dt>Certification report</dt><dd>Missing</dd></div><div><dt>Artifact manifest</dt><dd>Not verified</dd></div></dl>
        <button disabled>Publish immutable version</button>
      </aside>
    </div>
  </section>;
}
