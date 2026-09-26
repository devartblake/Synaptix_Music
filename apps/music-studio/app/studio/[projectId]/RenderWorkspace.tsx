"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { computeProjectChecksum } from "@synaptix/command-system";
import { MusicProjectSchema, type MusicProject } from "@synaptix/project-model";
import { RenderJobSchema, RenderManifestSchema, type RenderJob } from "@synaptix/render-contracts";
import { Button, Panel, Badge } from "../../../components/ui/StudioControls";
import {
  createExportManifest,
  safeDownloadUrl,
  type ExportOptions
} from "../../../lib/platform/render-export-model";
import { extractErrorMessage } from "../../../lib/platform/platform-project-repository";
import styles from "./render.module.css";

const RequestSchema = z.object({
  manifest: RenderManifestSchema,
  idempotencyKey: z.string().min(1)
});
type ExportRequest = z.infer<typeof RequestSchema>;
const active = (job: RenderJob) => job.status === "queued" || job.status === "running";
async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`/api/platform/${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(extractErrorMessage(await response.text(), response.status));
  return response.json() as Promise<unknown>;
}

export function RenderWorkspace({
  project,
  onClose,
  onSync
}: {
  project: MusicProject;
  onClose(): void;
  onSync(): Promise<unknown>;
}) {
  const [options, setOptions] = useState<ExportOptions>({
    scope: "master",
    format: "wav",
    sampleRate: 48000,
    bitDepth: 24,
    tail: 2,
    normalize: false,
    trackIds: project.tracks.filter((track) => track.kind === "instrument").map((track) => track.id)
  });
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [message, setMessage] = useState("Loading render jobs…");
  const [error, setError] = useState<string | null>(null);
  const [pendingRequest, setPendingRequest] = useState<ExportRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const action = useRef(false);
  const [refresh, setRefresh] = useState(0);
  const [links, setLinks] = useState<Record<string, string>>({});
  const key = `synaptix-music:export-request:v1:${project.projectId}`;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      const parsed = RequestSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? "null"));
      if (parsed.success && parsed.data.manifest.projectId === project.projectId)
        setPendingRequest(parsed.data);
    } catch {
      /* Preferences are optional. */
    }
  }, [key, project.projectId]);
  function remember(value: ExportRequest | null) {
    setPendingRequest(value);
    try {
      if (value) localStorage.setItem(key, JSON.stringify(value));
      else localStorage.removeItem(key);
    } catch {
      /* Retry still works this session. */
    }
  }
  function merge(values: RenderJob[]) {
    setJobs((current) => {
      const map = new Map(current.map((job) => [job.jobId, job]));
      for (const job of values) {
        const previous = map.get(job.jobId);
        if (!previous || job.updatedAt >= previous.updatedAt) map.set(job.jobId, job);
      }
      return [...map.values()].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    });
  }
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = z
          .object({ jobs: z.array(RenderJobSchema) })
          .parse(await request("render-jobs", { signal: controller.signal }));
        if (controller.signal.aborted) return;
        const values = result.jobs.filter((job) => job.manifest.projectId === project.projectId);
        merge(values);
        setMessage(
          values.some(active)
            ? "Rendering in the background. Status refreshes automatically."
            : "Render history is up to date."
        );
      } catch (cause) {
        if (!controller.signal.aborted)
          setMessage(
            `Render service unavailable: ${cause instanceof Error ? cause.message : "Try again."}`
          );
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [project.projectId, refresh]);
  useEffect(() => {
    if (pendingRequest && jobs.some((job) => job.idempotencyKey === pendingRequest.idempotencyKey))
      remember(null);
  }, [jobs, pendingRequest]);

  async function perform(work: () => Promise<void>) {
    if (action.current) return;
    action.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "Export request failed.");
    } finally {
      action.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function submit() {
    await perform(async () => {
      let payload = pendingRequest;
      if (!payload) {
        const manifest = await createExportManifest(project, options);
        await onSync();
        const remote = z
          .object({ project: MusicProjectSchema })
          .parse(await request(`projects/${encodeURIComponent(project.projectId)}`)).project;
        if (
          remote.revisionId !== manifest.revisionId ||
          (await computeProjectChecksum(remote)) !== manifest.projectChecksumSha256
        ) {
          throw new Error(
            "Save and sync this exact project revision before rendering. Resolve any cloud conflict, then retry."
          );
        }
        payload = { manifest, idempotencyKey: `studio-export:${manifest.renderId}` };
        if (!mounted.current) return;
        remember(payload);
      }
      const job = RenderJobSchema.parse(
        await request("render-jobs", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": payload.idempotencyKey
          },
          body: JSON.stringify({ manifest: payload.manifest })
        })
      );
      if (!mounted.current) return;
      if (
        job.manifest.renderId !== payload.manifest.renderId ||
        job.manifest.projectId !== project.projectId
      )
        throw new Error("Render response did not match the submitted request.");
      merge([job]);
      remember(null);
      setRefresh((value) => value + 1);
    });
  }
  const update = (patch: Partial<ExportOptions>) =>
    setOptions((current) => ({ ...current, ...patch }));
  return (
    <Panel aria-label="Render and export workspace">
      <header className={styles.header}>
        <div>
          <span className="eyebrow">Production output</span>
          <h2>Render & export</h2>
          <p>
            Export a synced project revision. Rendering requires the platform service and a
            configured render worker.
          </p>
        </div>
        <Button onClick={onClose}>Back to arrangement</Button>
      </header>
      <div className={styles.layout}>
        <form
          className={styles.settings}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h3>Export settings</h3>
          <p>Current revision: {project.revisionId.slice(0, 12)}</p>
          <fieldset disabled={busy || Boolean(pendingRequest)}>
            <legend>Output</legend>
            <label>
              Scope
              <select
                value={options.scope}
                onChange={(event) =>
                  update({ scope: event.target.value as ExportOptions["scope"] })
                }
              >
                <option value="master">Master mix</option>
                <option value="stems">Instrument stems</option>
              </select>
            </label>
            {options.scope === "stems" && (
              <fieldset>
                <legend>Tracks</legend>
                {project.tracks
                  .filter((track) => track.kind === "instrument")
                  .map((track) => (
                    <label key={track.id} className={styles.check}>
                      <input
                        type="checkbox"
                        checked={options.trackIds.includes(track.id)}
                        onChange={(event) =>
                          update({
                            trackIds: event.target.checked
                              ? [...options.trackIds, track.id]
                              : options.trackIds.filter((id) => id !== track.id)
                          })
                        }
                      />
                      {track.name}
                    </label>
                  ))}
                <p>
                  Stems are isolated, pre-bus outputs with track volume/pan; bus, return, and master
                  processing apply to the master mix.
                </p>
              </fieldset>
            )}
            <label>
              Format
              <select
                value={options.format}
                onChange={(event) =>
                  update({ format: event.target.value as ExportOptions["format"] })
                }
              >
                <option value="wav">WAV</option>
                <option value="mp3">MP3</option>
                <option value="ogg">OGG</option>
              </select>
            </label>
            <label>
              Sample rate
              <select
                value={options.sampleRate}
                onChange={(event) =>
                  update({ sampleRate: Number(event.target.value) as ExportOptions["sampleRate"] })
                }
              >
                {[44100, 48000, 96000].map((rate) => (
                  <option key={rate} value={rate}>
                    {rate} Hz
                  </option>
                ))}
              </select>
            </label>
            <label>
              PCM bit depth
              <select
                value={options.bitDepth}
                onChange={(event) =>
                  update({ bitDepth: Number(event.target.value) as ExportOptions["bitDepth"] })
                }
              >
                {[16, 24, 32].map((depth) => (
                  <option key={depth} value={depth}>
                    {depth} bit
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tail seconds
              <input
                type="number"
                min={0}
                max={30}
                step={0.5}
                value={options.tail}
                onChange={(event) => update({ tail: Number(event.target.value) })}
              />
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={options.normalize}
                onChange={(event) => update({ normalize: event.target.checked })}
              />
              Normalize peak to −1 dBFS
            </label>
          </fieldset>
          {pendingRequest && (
            <p role="status">
              Submission awaiting confirmation for revision{" "}
              {pendingRequest.manifest.revisionId.slice(0, 12)}. Retry reuses the same request,
              including after reload.
            </p>
          )}
          <Button
            variant="primary"
            disabled={
              busy || (!pendingRequest && options.scope === "stems" && !options.trackIds.length)
            }
            type="submit"
          >
            {busy ? "Working…" : pendingRequest ? "Retry submission" : "Render current revision"}
          </Button>
          {pendingRequest && (
            <Button
              disabled={busy}
              onClick={() => {
                remember(null);
                setError(null);
              }}
            >
              Edit export settings
            </Button>
          )}
          {pendingRequest && (
            <small>
              Editing settings starts a new request. Check history first if the previous submission
              may have reached the worker.
            </small>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </form>
        <section className={styles.history} aria-label="Render jobs">
          <div className={styles.historyHeader}>
            <h3>Render history</h3>
            <Button onClick={() => setRefresh((value) => value + 1)}>Refresh jobs</Button>
          </div>
          <p role="status">{message}</p>
          {!jobs.length && <p>No render jobs found for this project.</p>}
          {jobs.map((job) => (
            <article
              className={styles.job}
              key={job.jobId}
              aria-label={`Render ${job.manifest.revisionId}`}
            >
              <div className={styles.historyHeader}>
                <strong>
                  {job.manifest.scope.kind === "master" ? "Master mix" : "Stems"} ·{" "}
                  {job.manifest.output.format.toUpperCase()}
                </strong>
                <Badge>{job.status.replaceAll("_", " ")}</Badge>
              </div>
              <p>
                Revision {job.manifest.revisionId.slice(0, 12)} · Attempt {job.attempt}/
                {job.maxAttempts}
              </p>
              {job.nextAttemptAt && (
                <p>Next attempt: {new Date(job.nextAttemptAt).toLocaleString()}</p>
              )}
              {(job.lastError || job.result?.errorMessage) && (
                <p className={styles.error}>{job.result?.errorMessage ?? job.lastError}</p>
              )}
              {job.result?.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
              {active(job) && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const result = RenderJobSchema.parse(
                        await request(`render-jobs/${encodeURIComponent(job.jobId)}/cancel`, {
                          method: "POST"
                        })
                      );
                      if (mounted.current) merge([result]);
                    })
                  }
                >
                  Cancel render
                </Button>
              )}
              {job.status === "completed" &&
                job.result?.artifacts.map((artifact) => (
                  <div className={styles.artifact} key={artifact.artifactId}>
                    <div>
                      <strong>{artifact.fileName}</strong>
                      <small>
                        {(artifact.byteLength / 1024).toFixed(1)} KB ·{" "}
                        {artifact.durationSeconds.toFixed(1)} s
                      </small>
                    </div>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          const result = z
                            .object({ artifactId: z.string(), downloadUrl: z.string() })
                            .parse(
                              await request(
                                `render-jobs/${encodeURIComponent(job.jobId)}/artifacts/${encodeURIComponent(artifact.artifactId)}/download-url`
                              )
                            );
                          if (result.artifactId !== artifact.artifactId)
                            throw new Error("Download response did not match the artifact.");
                          const url = safeDownloadUrl(result.downloadUrl);
                          if (mounted.current)
                            setLinks((current) => ({ ...current, [artifact.artifactId]: url }));
                        })
                      }
                    >
                      {links[artifact.artifactId] ? "Refresh link" : "Get download link"}
                    </Button>
                    {links[artifact.artifactId] && (
                      <a
                        href={links[artifact.artifactId]}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={artifact.fileName}
                      >
                        Download {artifact.fileName}
                      </a>
                    )}
                  </div>
                ))}
            </article>
          ))}
        </section>
      </div>
    </Panel>
  );
}
