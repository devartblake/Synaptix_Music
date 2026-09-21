"use client";

import { useEffect, useMemo, useState } from "react";

import { RenderJobSchema, type RenderJob } from "@synaptix/render-contracts";
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
