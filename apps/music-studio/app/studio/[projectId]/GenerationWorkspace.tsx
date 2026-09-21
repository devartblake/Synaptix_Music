"use client";

import { useEffect, useRef, useState } from "react";

import type { GenerationProposal } from "@synaptix/generator-contracts";
import {
  TerminalGenerationJobStatuses,
  type GenerationJob,
  type GenerationJobStatusEvent
} from "@synaptix/platform-contracts";
import type { MusicProject } from "@synaptix/project-model";

import {
  GENERATION_PRESETS,
  buildGenerationJobRequest,
  formForPreset,
  interpretCreativeBrief,
  proposalSummary,
  type GenerationForm,
  type GenerationPresetId
} from "../../../lib/platform/generation-workspace-model";
import { listGenerationJobs } from "../../../src/lib/generation-status-recovery";
import {
  subscribeToGenerationJobStatus,
  type GenerationJobRealtimeSubscription
} from "../../../src/lib/generation-job-realtime";
import { pollGenerationJob, submitGenerationJob } from "../../../src/lib/platform-api";
import { FrequencyDroneInstrument } from "./FrequencyDroneInstrument";
import { BrowserAppliedGenerationJobRegistry } from "../../../src/lib/apply-completed-generation-job";

interface GenerationWorkspaceProps {
  project: MusicProject;
  onApply(proposal: GenerationProposal, jobId: string): Promise<void>;
  onAddDrone(frequencyHz: number): Promise<void>;
  onClose(): void;
}

function newestProjectJob(jobs: GenerationJob[], projectId: string): GenerationJob | null {
  return jobs
    .filter((job) => job.projectId === projectId)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null;
}

export function GenerationWorkspace({ project, onApply, onAddDrone, onClose }: GenerationWorkspaceProps) {
  const [form, setForm] = useState<GenerationForm>(() => formForPreset("bright-round", Math.floor(Math.random() * 100_000)));
  const [brief, setBrief] = useState("Upbeat trivia loop with a clear build and satisfying victory section");
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [statusMessage, setStatusMessage] = useState("Ready to generate a variation.");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [appliedJobId, setAppliedJobId] = useState<string | null>(null);
  const [realtimeState, setRealtimeState] = useState<"polling" | "connecting" | "connected" | "reconnecting">("polling");
  const idempotencyKey = useRef(crypto.randomUUID());
  const appliedRegistry = useRef(new BrowserAppliedGenerationJobRegistry());
  const realtimeHubUrl = process.env.NEXT_PUBLIC_SYNAPTIX_SIGNALR_HUB_URL?.trim();

  function receiveRealtimeStatus(event: GenerationJobStatusEvent): void {
    setJob((current) => current?.jobId === event.jobId ? { ...current, ...event } : current);
    setStatusMessage(
      event.status === "completed"
        ? "Variation ready for review."
        : `Generation ${event.status}. Attempt ${event.attemptCount}.`
    );
  }

  async function followJob(initial: GenerationJob, signal?: AbortSignal): Promise<void> {
    setJob(initial);
    if (TerminalGenerationJobStatuses.has(initial.status as never)) return;
    const completed = await pollGenerationJob(initial.jobId, {
      signal,
      onUpdate: (update) => {
        setJob(update);
        setStatusMessage(`Generation ${update.status}. Attempt ${update.attemptCount}.`);
      }
    });
    setJob(completed);
    setStatusMessage(completed.status === "completed" ? "Variation ready for review." : `Generation ${completed.status}.`);
  }

  useEffect(() => {
    const controller = new AbortController();
    void listGenerationJobs(false, 25, controller.signal)
      .then((jobs) => {
        const recovered = newestProjectJob(jobs, project.projectId);
        if (!recovered) return;
        setStatusMessage("Recovered the latest generation job for this project.");
        return followJob(recovered, controller.signal);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setStatusMessage(reason instanceof Error ? reason.message : "Generation recovery unavailable.");
      });
    return () => controller.abort();
  }, [project.projectId]);

  useEffect(() => {
    if (!realtimeHubUrl || !job?.jobId || TerminalGenerationJobStatuses.has(job.status as never)) {
      setRealtimeState("polling");
      return;
    }

    let cancelled = false;
    let subscription: GenerationJobRealtimeSubscription | null = null;
    void subscribeToGenerationJobStatus({
      hubUrl: realtimeHubUrl,
      jobId: job.jobId,
      onStatus: receiveRealtimeStatus,
      onRecovered: (recovered) => {
        setJob(recovered);
        setStatusMessage(recovered.status === "completed" ? "Variation ready for review." : `Generation ${recovered.status}.`);
      },
      onConnectionState: (state) => {
        if (cancelled) return;
        setRealtimeState(state === "closed" ? "polling" : state);
      }
    }).then((activeSubscription) => {
      if (cancelled) void activeSubscription.stop();
      else subscription = activeSubscription;
    }).catch(() => {
      if (!cancelled) setRealtimeState("polling");
    });

    return () => {
      cancelled = true;
      if (subscription) void subscription.stop();
    };
  }, [job?.jobId, realtimeHubUrl]);

  function choosePreset(presetId: GenerationPresetId): void {
    setForm((current) => formForPreset(presetId, current.seed));
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
  }

  function updateForm<K extends keyof GenerationForm>(key: K, value: GenerationForm[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
    idempotencyKey.current = crypto.randomUUID();
    setError(null);
  }

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    setAppliedJobId(null);
    try {
      const correlationId = crypto.randomUUID();
      const request = buildGenerationJobRequest(
        project.projectId,
        project.revisionId,
        form,
        idempotencyKey.current,
        correlationId
      );
      setStatusMessage("Submitting generation job…");
      const created = await submitGenerationJob(request);
      setStatusMessage("Generation queued. Waiting for durable status…");
      await followJob(created);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Generation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function apply(): Promise<void> {
    if (job?.status !== "completed" || !job.result || appliedJobId === job.jobId) return;
    setApplying(true);
    setError(null);
    try {
      if (await appliedRegistry.current.has(job.jobId)) {
        setAppliedJobId(job.jobId);
        setStatusMessage("This variation was already applied on this browser.");
        return;
      }
      await onApply(job.result, job.jobId);
      await appliedRegistry.current.add(job.jobId);
      setAppliedJobId(job.jobId);
      setStatusMessage("Variation applied as a reversible project revision.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The variation could not be applied.");
    } finally {
      setApplying(false);
    }
  }

  const summary = job?.result ? proposalSummary(job.result) : null;

  return <section className="generation-workspace" aria-label="AI generation workspace">
    <header className="generation-header">
      <div><span className="eyebrow">Synaptix generator</span><h2>Create a project variation</h2><p>Structured procedural generation with durable status and an explicit apply step.</p></div>
      <button onClick={onClose}>Back to arrangement</button>
    </header>

    <div className="generation-grid">
      <div><FrequencyDroneInstrument onUseForGeneration={(tone) => { setBrief(`Build a musical variation around a ${tone.frequencyHz} Hz ${tone.waveform} drone as a tonal texture. Preserve the frequency as an oscillator layer rather than a health or therapeutic claim.`); setStatusMessage(`${tone.frequencyHz} Hz selected as a procedural-generation seed.`); }} onAddToProject={(tone) => void onAddDrone(tone.frequencyHz)} />
      <form className="generation-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label>Creative brief
          <textarea value={brief} rows={3} onChange={(event) => setBrief(event.target.value)} />
        </label>
        <button type="button" onClick={() => setForm((current) => interpretCreativeBrief(current, brief))}>Interpret brief</button>
        <label>Preset
          <select value={form.presetId} onChange={(event) => choosePreset(event.target.value as GenerationPresetId)}>
            {GENERATION_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} — {preset.description}</option>)}
          </select>
        </label>
        <div className="generation-fields">
          <label>Mood<select value={form.mood} onChange={(event) => updateForm("mood", event.target.value as GenerationForm["mood"])}><option value="upbeat">Upbeat</option><option value="tense">Tense</option><option value="triumphant">Triumphant</option></select></label>
          <label>Key<select value={form.key} onChange={(event) => updateForm("key", event.target.value as GenerationForm["key"])}>{["C minor", "D minor", "E minor", "F minor", "G minor", "A minor"].map((key) => <option key={key}>{key}</option>)}</select></label>
          <label>Tempo<input type="number" min={90} max={140} value={form.tempo} onChange={(event) => updateForm("tempo", event.target.valueAsNumber)} /></label>
          <label>Bars<select value={form.durationBars} onChange={(event) => updateForm("durationBars", Number(event.target.value))}>{[8, 16, 24, 32, 48, 64].map((bars) => <option key={bars}>{bars}</option>)}</select></label>
        </div>
        <label>Energy <output>{Math.round(form.energy * 100)}%</output><input type="range" min="0" max="1" step="0.05" value={form.energy} onChange={(event) => updateForm("energy", Number(event.target.value))} /></label>
        <label>Complexity <output>{Math.round(form.complexity * 100)}%</output><input type="range" min="0" max="1" step="0.05" value={form.complexity} onChange={(event) => updateForm("complexity", Number(event.target.value))} /></label>
        <label>Seed<input type="number" min="0" max="2147483647" value={form.seed} onChange={(event) => updateForm("seed", event.target.valueAsNumber)} /></label>
        <button className="generation-submit" type="submit" disabled={submitting}>{submitting ? "Generating…" : "Generate variation"}</button>
      </form></div>

      <section className="generation-preview" aria-label="Generated variation preview">
        <div className="job-status" role="status" aria-live="polite" aria-atomic="true"><span aria-hidden="true" className={`status-dot ${job?.status === "failed" || job?.status === "deadLetter" ? "danger" : ""}`} /><div><strong>{job ? job.status : "Not started"}</strong><p>{statusMessage}</p><p className="realtime-status">Live updates: {realtimeState === "polling" ? "durable polling" : realtimeState}</p></div></div>
        {error && <p className="generation-error" role="alert">{error}</p>}
        {job?.result && summary ? <>
          <div className="preview-hero"><span>{job.result.mood}</span><strong>{job.result.key}</strong><small>{job.result.tempo} BPM · seed {job.result.provenance.seed}</small></div>
          <div className="preview-stats"><div><strong>{summary.trackCount}</strong><span>Tracks</span></div><div><strong>{summary.sectionCount}</strong><span>Sections</span></div><div><strong>{summary.noteCount}</strong><span>Notes</span></div><div><strong>{summary.durationBars}</strong><span>Bars</span></div></div>
          <div className="section-map">{job.result.sections.map((section) => <div key={section.id} style={{ flex: section.bars }}><span>{section.name}</span><small>{section.bars} bars</small></div>)}</div>
          {job.result.warnings.length > 0 && <ul className="generation-warnings">{job.result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          <button className="generation-apply" disabled={applying || appliedJobId === job.jobId} onClick={() => void apply()}>{appliedJobId === job.jobId ? "Applied to project" : applying ? "Applying…" : "Apply variation to project"}</button>
          <p className="apply-note">Applying replaces the current arrangement, creates a persisted revision, and can be undone.</p>
        </> : <div className="preview-empty"><strong>No variation preview yet</strong><p>Submit a job or recover an existing one to inspect its musical structure before applying it.</p></div>}
      </section>
    </div>
  </section>;
}
