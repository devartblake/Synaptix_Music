import { RENDER_ENGINE_VERSION, type RenderManifest } from "@synaptix/render-contracts";

/**
 * A render asked for a different synthesis engine than this worker runs. The worker can only
 * render with its own engine, and certification requires the artifact's engine version to equal
 * the request's, so it refuses instead of producing audio labelled with the wrong engine.
 */
export class EngineVersionMismatchError extends Error {
  constructor(readonly requested: string) {
    super(
      `This render worker runs engine ${RENDER_ENGINE_VERSION}, but the render asked for engine ${requested}. ` +
        "Reload the studio and export again."
    );
    this.name = "EngineVersionMismatchError";
  }
}

export function assertWorkerEngine(manifest: RenderManifest): void {
  if (manifest.engineVersion !== RENDER_ENGINE_VERSION) {
    throw new EngineVersionMismatchError(manifest.engineVersion);
  }
}
