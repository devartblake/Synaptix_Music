import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RenderedArtifact } from "./offline-renderer.ts";
import type { ArtifactSink } from "./worker.ts";

// Placeholder storage until object-storage upload/signed-delivery is built
// (roadmap item 4: "Export authorization and retention... Download and
// signed-delivery boundaries"). Writes each render's artifacts to
// <outputDir>/<renderId>/<fileName> on local disk.
export class FilesystemArtifactSink implements ArtifactSink {
  constructor(private readonly outputDir: string) {}

  async store(renderId: string, artifact: RenderedArtifact): Promise<void> {
    const dir = path.join(this.outputDir, renderId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, artifact.metadata.fileName), artifact.bytes);
  }
}
