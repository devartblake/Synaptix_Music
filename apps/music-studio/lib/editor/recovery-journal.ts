import { parseVersionedMusicProject } from "@synaptix/project-storage";
import type { PlatformRevisionEnvelope } from "@synaptix/project-storage/platform-sync";

const KEY_PREFIX = "synaptix-music:recovery:v1:";

export interface RecoveryEntry {
  envelope: PlatformRevisionEnvelope;
  journaledAt: string;
}

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Write-ahead copy of an edit that is about to be saved. It lives outside
 * IndexedDB, so an edit survives a tab crash mid-save or a failed save
 * followed by closing the tab. Returns false when the journal is unavailable.
 */
export function journalRevision(
  envelope: PlatformRevisionEnvelope,
  store: KeyValueStore | null = defaultStore(),
  now: () => string = () => new Date().toISOString()
): boolean {
  if (!store) return false;
  try {
    const entry: RecoveryEntry = { envelope, journaledAt: now() };
    store.setItem(KEY_PREFIX + envelope.projectId, JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}

export function clearRecovery(projectId: string, store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.removeItem(KEY_PREFIX + projectId);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

/**
 * An unsaved edit left behind for [projectId], if it is newer than what was
 * saved. Entries that are unreadable, for another project, or already saved
 * are discarded.
 */
export function readRecovery(
  projectId: string,
  savedRevisionId: string | null,
  store: KeyValueStore | null = defaultStore()
): RecoveryEntry | null {
  let raw: string | null = null;
  try {
    raw = store?.getItem(KEY_PREFIX + projectId) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as RecoveryEntry;
    const project = parseVersionedMusicProject(entry.envelope?.project);
    const valid =
      entry.envelope.projectId === projectId &&
      project.projectId === projectId &&
      entry.envelope.revision?.revisionId === project.revisionId &&
      typeof entry.journaledAt === "string";
    if (valid && project.revisionId !== savedRevisionId) {
      return { envelope: { ...entry.envelope, project }, journaledAt: entry.journaledAt };
    }
  } catch {
    // Unreadable entry: fall through and drop it.
  }
  clearRecovery(projectId, store);
  return null;
}
