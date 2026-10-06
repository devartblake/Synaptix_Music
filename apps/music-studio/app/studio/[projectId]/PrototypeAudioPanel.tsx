"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../../../components/ui/StudioControls";
import { AudioJobSchema, describeJob, isFinished, newerJob, type AudioJob } from "../../../lib/audio-prototype/job-model";

interface Status {
  enabled: boolean;
  reachable?: boolean;
  model?: string;
  loaded?: boolean;
  device?: string;
}

interface Clip {
  url: string;
  fileName: string;
  model: string;
  seconds: string;
  generationSeconds: string;
}

const DURATIONS = [5, 10, 15, 20, 30];
/** The job in flight, so a reload picks its progress back up. */
const JOB_KEY = "synaptix-music:prototype-audio-job:v1";
const POLL_MS = 1500;

function rememberJob(jobId: string | null): void {
  try {
    if (jobId) sessionStorage.setItem(JOB_KEY, jobId);
    else sessionStorage.removeItem(JOB_KEY);
  } catch { /* Resuming after a reload is optional. */ }
}

function rememberedJob(): string | null {
  try { return sessionStorage.getItem(JOB_KEY); } catch { return null; }
}

async function messageFrom(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

/**
 * Text-to-audio sketches from MusicGen on a local GPU. The weights are non-commercial
 * (CC-BY-NC 4.0), so clips are for listening and reference only: they're never added to the
 * project, rendered, or published.
 *
 * A generation is a queued job on the service: the panel follows its live progress (server-sent
 * events, with polling as the fallback) and fetches the WAV when it's done.
 */
export function PrototypeAudioPanel({ suggestedPrompt }: { suggestedPrompt: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [prompt, setPrompt] = useState(suggestedPrompt);
  const [edited, setEdited] = useState(false);
  const [duration, setDuration] = useState(10);
  const [seed, setSeed] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<AudioJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const clipUrl = useRef<string | null>(null);
  const stopFollowing = useRef<(() => void) | null>(null);

  const loadAudio = useCallback(async (finished: AudioJob) => {
    const response = await fetch(`/api/audio-prototype/jobs/${finished.jobId}/audio`, { cache: "no-store" });
    if (!response.ok) {
      setError(await messageFrom(response, "The clip couldn't be downloaded. Try again."));
      return;
    }
    const blob = await response.blob();
    if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    clipUrl.current = URL.createObjectURL(blob);
    const clipSeed = response.headers.get("x-synaptix-seed") ?? String(finished.seed ?? "");
    setClip({
      url: clipUrl.current,
      fileName: `prototype-audio-seed-${clipSeed}.wav`,
      model: response.headers.get("x-synaptix-model") ?? "MusicGen",
      seconds: response.headers.get("x-synaptix-duration-seconds") ?? String(finished.durationSeconds ?? ""),
      generationSeconds: response.headers.get("x-synaptix-generation-seconds") ?? "?"
    });
    setStatus((current) => current && { ...current, loaded: true });
  }, []);

  /** Follow a job until it finishes: live events first, polling if the stream drops. */
  const follow = useCallback((jobId: string) => {
    stopFollowing.current?.();
    let stopped = false;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      stopped = true;
      source?.close();
      if (timer) clearTimeout(timer);
    };
    stopFollowing.current = stop;

    const apply = (incoming: AudioJob) => {
      if (stopped) return;
      setJob((current) => newerJob(current, incoming));
      if (!isFinished(incoming)) return;
      stop();
      rememberJob(null);
      if (incoming.status === "completed") void loadAudio(incoming);
      else if (incoming.status === "failed") setError(describeJob(incoming));
    };

    const poll = async () => {
      if (stopped) return;
      try {
        const response = await fetch(`/api/audio-prototype/jobs/${jobId}`, { cache: "no-store" });
        if (response.status === 404) {
          stop();
          rememberJob(null);
          setJob(null);
          return;
        }
        if (response.ok) apply(AudioJobSchema.parse(await response.json()));
      } catch { /* Try again on the next tick. */ }
      if (!stopped) timer = setTimeout(() => void poll(), POLL_MS);
    };

    if (typeof EventSource === "undefined") {
      void poll();
      return;
    }
    source = new EventSource(`/api/audio-prototype/jobs/${jobId}/events`);
    source.addEventListener("status", (event) => {
      const parsed = AudioJobSchema.safeParse(JSON.parse((event as MessageEvent<string>).data));
      if (parsed.success) apply(parsed.data);
    });
    source.onerror = () => {
      // The stream closes after the last event too; polling settles either case.
      source?.close();
      source = null;
      if (!stopped) void poll();
    };
  }, [loadAudio]);

  useEffect(() => {
    fetch("/api/audio-prototype", { cache: "no-store" })
      .then((response) => response.json() as Promise<Status>)
      .then((value) => {
        setStatus(value);
        const resumed = value.enabled ? rememberedJob() : null;
        if (resumed) follow(resumed);
      })
      .catch(() => setStatus({ enabled: false }));
    return () => {
      stopFollowing.current?.();
      if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    };
  }, [follow]);

  // Follow the generator's controls until the prompt is edited by hand.
  useEffect(() => { if (!edited) setPrompt(suggestedPrompt); }, [suggestedPrompt, edited]);

  if (!status?.enabled) return null;

  const running = job !== null && !isFinished(job);
  const busy = submitting || running;

  async function generate(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/audio-prototype", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, durationSeconds: duration, seed })
      });
      if (!response.ok) {
        setError(await messageFrom(response, "Prototype audio failed. Try again."));
        return;
      }
      const submitted = AudioJobSchema.parse(await response.json());
      setJob(submitted);
      rememberJob(submitted.jobId);
      follow(submitted.jobId);
    } catch {
      setError("The studio couldn't reach its server. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(): Promise<void> {
    if (!job) return;
    const response = await fetch(`/api/audio-prototype/jobs/${job.jobId}`, { method: "DELETE" });
    if (response.ok) {
      stopFollowing.current?.();
      rememberJob(null);
      setJob(AudioJobSchema.parse(await response.json()));
    } else {
      setError(await messageFrom(response, "The job couldn't be cancelled."));
    }
  }

  return (
    <section className="prototype-audio" aria-labelledby="prototype-audio-heading">
      <header>
        <h3 id="prototype-audio-heading">Prototype audio</h3>
        <span className="prototype-badge">Non-commercial · prototype only</span>
      </header>
      <p className="prototype-note">
        Sketch a finished-sounding idea from text with MusicGen on your GPU. Its model licence
        (CC-BY-NC 4.0) doesn’t allow commercial use, so clips are for listening and reference only
        and are never added to your project or published.
      </p>
      {status.reachable === false && (
        <p className="generation-error" role="status">The prototype audio service isn’t running. Start the stack with COMPOSE_PROFILES=local-ai.</p>
      )}
      <form onSubmit={(event) => { event.preventDefault(); void generate(); }}>
        <label>Prompt
          <textarea rows={3} maxLength={500} value={prompt}
            onChange={(event) => { setPrompt(event.target.value); setEdited(true); }} />
        </label>
        {edited && <Button type="button" onClick={() => setEdited(false)}>Use the generator’s settings</Button>}
        <div className="generation-fields">
          <label>Length<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
            {DURATIONS.map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
          </select></label>
          <label>Seed<input type="number" min="0" max="2147483647" value={seed}
            onChange={(event) => setSeed(event.target.valueAsNumber || 0)} /></label>
        </div>
        <Button type="submit" disabled={busy || !prompt.trim()}>
          {submitting ? "Submitting…" : running ? "Generating…" : "Generate prototype audio"}
        </Button>
      </form>
      {job && !isFinished(job) && (
        <div className="prototype-progress">
          <progress aria-label="Prototype audio progress"
            value={job.status === "generating" ? job.progress : undefined} max={1} />
          <p role="status" className="prototype-note">{describeJob(job)}</p>
          {job.status === "queued" && <Button type="button" onClick={() => void cancel()}>Cancel</Button>}
        </div>
      )}
      {job?.status === "cancelled" && <p role="status" className="prototype-note">Cancelled.</p>}
      {error && <p className="generation-error" role="alert">{error}</p>}
      {clip && (
        <figure className="prototype-clip">
          <audio controls src={clip.url} aria-label="Prototype audio clip" />
          <figcaption>
            {clip.seconds} s from {clip.model} in {clip.generationSeconds} s ·{" "}
            <a href={clip.url} download={clip.fileName}>Download WAV</a> · prototype only, not for release
          </figcaption>
        </figure>
      )}
    </section>
  );
}
