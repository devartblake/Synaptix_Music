import { computeProjectChecksum } from "@synaptix/command-system";
import { parseVersionedMusicProject, type StoredMusicProject } from "@synaptix/project-storage";

export const PROJECT_FILE_FORMAT = "synaptix-music-project";
export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_EXTENSION = ".synaptix.json";

/** A problem with an imported file, worded for the person importing it. */
export class ProjectFileError extends Error {}

/** Serializes a project with a checksum so corruption or edits are detected on import. */
export async function createProjectFile(project: StoredMusicProject, exportedAt = new Date().toISOString()): Promise<string> {
  const validated = parseVersionedMusicProject(project);
  return JSON.stringify(
    {
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      exportedAt,
      checksumSha256: await computeProjectChecksum(validated),
      project: validated
    },
    null,
    2
  );
}

export function projectFileName(project: StoredMusicProject): string {
  const slug = project.metadata.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${slug || "project"}${PROJECT_FILE_EXTENSION}`;
}

/**
 * Reads an exported project as a new local copy: it gets a fresh project ID,
 * so importing can never overwrite a project already in this browser.
 */
export async function readProjectFile(
  text: string,
  newProjectId: string = crypto.randomUUID(),
  now: string = new Date().toISOString()
): Promise<StoredMusicProject> {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new ProjectFileError("This file isn't a Synaptix Music project (it isn't valid JSON).");
  }
  if (typeof file !== "object" || file === null || (file as { format?: unknown }).format !== PROJECT_FILE_FORMAT) {
    throw new ProjectFileError("This file isn't a Synaptix Music project file.");
  }
  const { version, checksumSha256, project } = file as {
    version?: unknown;
    checksumSha256?: unknown;
    project?: unknown;
  };
  if (version !== PROJECT_FILE_VERSION) {
    throw new ProjectFileError(`This project file uses version ${String(version)}, which this studio can't read.`);
  }
  // Plain (schema v1) and plug-in (schema v2) projects are both accepted.
  let parsed: StoredMusicProject;
  try {
    parsed = parseVersionedMusicProject(project);
  } catch {
    throw new ProjectFileError("This project file is incomplete or damaged and can't be imported.");
  }
  if (checksumSha256 !== (await computeProjectChecksum(parsed))) {
    throw new ProjectFileError("This project file was changed or damaged after export, so it wasn't imported.");
  }
  const copy = structuredClone(parsed);
  copy.projectId = newProjectId;
  copy.metadata.updatedAt = now;
  return parseVersionedMusicProject(copy);
}
