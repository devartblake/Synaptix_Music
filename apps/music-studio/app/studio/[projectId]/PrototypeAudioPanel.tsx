"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "../../../components/ui/StudioControls";

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

/**
 * Text-to-audio sketches from MusicGen on a local GPU. The weights are non-commercial
 * (CC-BY-NC 4.0), so clips are for listening and reference only: they're never added to the
 * project, rendered, or published.
 */
export function PrototypeAudioPanel({ suggestedPrompt }: { suggestedPrompt: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [prompt, setPrompt] = useState(suggestedPrompt);
  const [edited, setEdited] = useState(false);
  const [duration, setDuration] = useState(10);
  const [seed, setSeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const clipUrl = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/audio-prototype", { cache: "no-store" })
      .then((response) => response.json() as Promise<Status>)
      .then(setStatus)
      .catch(() => setStatus({ enabled: false }));
    return () => { if (clipUrl.current) URL.revokeObjectURL(clipUrl.current); };
  }, []);

  // Follow the generator's controls until the prompt is edited by hand.
  useEffect(() => { if (!edited) setPrompt(suggestedPrompt); }, [suggestedPrompt, edited]);

  if (!status?.enabled) return null;

  async function generate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/audio-prototype", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, durationSeconds: duration, seed })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "Prototype audio failed. Try again.");
        return;
      }
      const blob = await response.blob();
      if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
      clipUrl.current = URL.createObjectURL(blob);
      setClip({
        url: clipUrl.current,
        fileName: `prototype-audio-seed-${seed}.wav`,
        model: response.headers.get("x-synaptix-model") ?? "MusicGen",
        seconds: response.headers.get("x-synaptix-duration-seconds") ?? String(duration),
        generationSeconds: response.headers.get("x-synaptix-generation-seconds") ?? "?"
      });
      setStatus((current) => current && { ...current, loaded: true });
    } catch {
      setError("The studio couldn't reach its server. Try again.");
    } finally {
      setBusy(false);
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
          {busy ? (status.loaded ? "Generating…" : "Loading the model and generating…") : "Generate prototype audio"}
        </Button>
      </form>
      {busy && <p role="status" className="prototype-note">This takes about as long as the clip on a laptop GPU, plus a minute the first time while the model loads.</p>}
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
