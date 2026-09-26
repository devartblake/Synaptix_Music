import type {
  HybridProjectRepository,
  RevisionUploadResult
} from "@synaptix/project-storage/platform-sync";

export interface ProjectSyncSnapshot {
  /** `signed-out`: the platform needs a SynaptixPlay sign-in; local saves are unaffected. */
  state: "idle" | "syncing" | "offline" | "signed-out" | "conflict" | "error";
  lastSyncedAt: string | null;
  conflicts: RevisionUploadResult[];
  error: string | null;
}

export class ProjectSyncCoordinator {
  private inFlight: Promise<ProjectSyncSnapshot> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repository: HybridProjectRepository,
    private readonly onChange: (snapshot: ProjectSyncSnapshot) => void
  ) {}

  async drain(): Promise<ProjectSyncSnapshot> {
    if (this.inFlight) return this.inFlight;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const snapshot: ProjectSyncSnapshot = {
        state: "offline",
        lastSyncedAt: null,
        conflicts: [],
        error: null
      };
      this.onChange(snapshot);
      return snapshot;
    }

    this.onChange({ state: "syncing", lastSyncedAt: null, conflicts: [], error: null });
    this.inFlight = this.repository
      .drain()
      .then((results) => {
        const conflicts = results.filter((result) => result.outcome === "conflict");
        const snapshot: ProjectSyncSnapshot = {
          state: conflicts.length > 0 ? "conflict" : "idle",
          lastSyncedAt: new Date().toISOString(),
          conflicts,
          error: null
        };
        this.onChange(snapshot);
        return snapshot;
      })
      .catch((error: unknown) => {
        const signedOut = (error as { status?: unknown } | null)?.status === 401;
        const snapshot: ProjectSyncSnapshot = signedOut
          ? { state: "signed-out", lastSyncedAt: null, conflicts: [], error: null }
          : {
              state: "error",
              lastSyncedAt: null,
              conflicts: [],
              error: error instanceof Error ? error.message : "Project synchronization failed."
            };
        this.onChange(snapshot);
        return snapshot;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  start(intervalMs = 30_000): () => void {
    const online = () => void this.drain();
    window.addEventListener("online", online);
    this.intervalId = setInterval(() => void this.drain(), intervalMs);
    void this.drain();
    return () => {
      window.removeEventListener("online", online);
      if (this.intervalId) clearInterval(this.intervalId);
      this.intervalId = null;
    };
  }
}
