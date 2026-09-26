"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type {
  AdaptiveGameAudioManifest,
  RenderJob,
  TransitionClock
} from "@synaptix/render-contracts";
import { AdaptivePreview } from "../../../lib/audio/adaptive-preview";
import { sha256 } from "../../../lib/platform/adaptive-evidence";
import { safeDownloadUrl } from "../../../lib/platform/render-export-model";
import { platformRequest } from "../../../lib/platform/platform-request";
import { Button } from "../../../components/ui/StudioControls";

export function AdaptivePreviewPanel({
  manifest,
  jobs,
  clock
}: {
  manifest: AdaptiveGameAudioManifest | null;
  jobs: RenderJob[];
  clock: TransitionClock;
}) {
  const player = useRef<AdaptivePreview | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [position, setPosition] = useState("Stopped");
  const [intensity, setIntensity] = useState(0.5);
  const [target, setTarget] = useState("");
  function log(value: string) {
    setEvents((current) => [value, ...current].slice(0, 12));
  }
  useEffect(() => {
    const stop = () => {
      player.current?.stop();
    };
    window.addEventListener("synaptix-stop-audio", stop);
    return () => window.removeEventListener("synaptix-stop-audio", stop);
  }, []);
  useEffect(() => {
    controller.current?.abort();
    void player.current?.dispose();
    player.current = null;
    setReady(false);
    setBusy(false);
    setPosition("Stopped");
    return () => {
      controller.current?.abort();
      void player.current?.dispose();
      player.current = null;
    };
  }, [manifest]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (player.current)
        setPosition(
          player.current.stateId
            ? `${player.current.stateId}: ${player.current.position.toFixed(2)} s`
            : "Stopped"
        );
    }, 100);
    return () => clearInterval(timer);
  }, []);
  async function load() {
    if (!manifest) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const context = new AudioContext();
    setBusy(true);
    setReady(false);
    try {
      await context.resume();
      const buffers = new Map<string, AudioBuffer>();
      for (const state of manifest.states) {
        if (buffers.has(state.masterArtifactId)) continue;
        const job = jobs.find((item) =>
          item.result?.artifacts.some((artifact) => artifact.artifactId === state.masterArtifactId)
        );
        const artifact = job?.result?.artifacts.find(
          (item) => item.artifactId === state.masterArtifactId
        );
        if (!job || !artifact) throw new Error("Preview artifact is unavailable.");
        if (artifact.byteLength > 100_000_000)
          throw new Error("Preview supports artifacts up to 100 MB each.");
        const grant = z
          .object({ artifactId: z.string(), downloadUrl: z.string() })
          .parse(
            await platformRequest(
              `render-jobs/${encodeURIComponent(job.jobId)}/artifacts/${encodeURIComponent(artifact.artifactId)}/download-url`,
              { signal: abort.signal }
            )
          );
        if (grant.artifactId !== artifact.artifactId)
          throw new Error("Preview grant does not match artifact.");
        const response = await fetch(safeDownloadUrl(grant.downloadUrl), {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)])
        });
        if (!response.ok) throw new Error("Preview audio download failed.");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (
          bytes.byteLength !== artifact.byteLength ||
          (await sha256(bytes)) !== artifact.checksumSha256
        )
          throw new Error("Preview audio failed checksum verification.");
        buffers.set(artifact.artifactId, await context.decodeAudioData(bytes.buffer));
      }
      if (abort.signal.aborted) {
        await context.close();
        return;
      }
      await player.current?.dispose();
      player.current = new AdaptivePreview(context, manifest, buffers, clock);
      setReady(true);
      log("Audio verified and loaded. Press Play preview to audition.");
    } catch (cause) {
      await context.close();
      if (!abort.signal.aborted) log(cause instanceof Error ? cause.message : "Preview failed.");
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="adaptive-state-card" aria-label="Interactive package preview">
      <h3>Runtime event simulator</h3>
      <p>
        Preview uses the rendered audio and configured loop, entry, trigger, and crossfade timing.
        Editing the draft stops playback.
      </p>
      <Button disabled={busy || !manifest} onClick={() => void load()}>
        {busy ? "Loading preview audio…" : "Load preview audio"}
      </Button>
      <Button
        disabled={!ready || busy}
        onClick={() =>
          void player.current
            ?.play()
            .then(() => log("Preview started."))
            .catch((cause) => log(String(cause)))
        }
      >
        Play preview
      </Button>
      <Button
        disabled={!ready}
        onClick={() => {
          player.current?.stop();
          log("Preview stopped.");
        }}
      >
        Stop preview
      </Button>
      <output aria-label="Preview position">{position}</output>
      <label>
        Target state
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">Select state</option>
          {manifest?.states.map((state) => (
            <option key={state.stateId} value={state.stateId}>
              {state.displayName}
            </option>
          ))}
        </select>
      </label>
      <Button
        disabled={!ready || !target}
        onClick={() => {
          try {
            log(player.current!.requestState(target));
          } catch (cause) {
            log(String(cause));
          }
        }}
      >
        Send set-state event
      </Button>
      <Button
        disabled={!ready || !target}
        onClick={() => {
          try {
            log(
              player.current!.triggerStinger(
                manifest!.states.find((state) => state.stateId === target)!.masterArtifactId
              )
            );
          } catch (cause) {
            log(String(cause));
          }
        }}
      >
        Audition target as stinger
      </Button>
      <label>
        Runtime intensity
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={intensity}
          onChange={(event) => setIntensity(Number(event.target.value))}
        />
      </label>
      <Button
        disabled={!ready}
        onClick={() => {
          try {
            log(player.current!.requestIntensity(intensity));
          } catch (cause) {
            log(String(cause));
          }
        }}
      >
        Send set-intensity event
      </Button>
      <div role="log" aria-label="Runtime events" aria-live="polite">
        {events.map((event, index) => (
          <p key={index}>{event}</p>
        ))}
      </div>
    </section>
  );
}
