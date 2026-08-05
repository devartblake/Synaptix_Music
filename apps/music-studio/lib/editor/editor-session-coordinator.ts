import type { PlatformRevisionEnvelope } from "@synaptix/project-storage/platform-sync";

export type EditorPersistenceState = "clean" | "saving" | "unsaved" | "failed";

export interface EditorSessionSnapshot {
  state: EditorPersistenceState;
  pendingRevisionId: string | null;
  error: string | null;
  readOnly: boolean;
  competingTabId: string | null;
}

export interface ProjectTabLeaseMessage {
  type: "claim" | "heartbeat" | "release";
  projectId: string;
  tabId: string;
  sentAt: number;
}

export interface BroadcastChannelLike {
  postMessage(message: ProjectTabLeaseMessage): void;
  addEventListener(type: "message", listener: (event: MessageEvent<ProjectTabLeaseMessage>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<ProjectTabLeaseMessage>) => void): void;
  close(): void;
}

export class EditorSessionCoordinator {
  private snapshotValue: EditorSessionSnapshot = {
    state: "clean",
    pendingRevisionId: null,
    error: null,
    readOnly: false,
    competingTabId: null
  };
  private pendingEnvelope: PlatformRevisionEnvelope | null = null;
  private readonly listeners = new Set<(snapshot: EditorSessionSnapshot) => void>();

  get snapshot(): EditorSessionSnapshot {
    return { ...this.snapshotValue };
  }

  subscribe(listener: (snapshot: EditorSessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  markSaving(envelope: PlatformRevisionEnvelope): void {
    this.pendingEnvelope = envelope;
    this.update({
      state: "saving",
      pendingRevisionId: envelope.revision.revisionId,
      error: null
    });
  }

  markSaved(revisionId: string): void {
    if (this.pendingEnvelope?.revision.revisionId === revisionId) {
      this.pendingEnvelope = null;
    }
    this.update({ state: "clean", pendingRevisionId: null, error: null });
  }

  markFailed(error: unknown): void {
    this.update({
      state: "failed",
      error: error instanceof Error ? error.message : String(error)
    });
  }

  markUnsaved(envelope: PlatformRevisionEnvelope): void {
    this.pendingEnvelope = envelope;
    this.update({
      state: "unsaved",
      pendingRevisionId: envelope.revision.revisionId,
      error: null
    });
  }

  async retry(save: (envelope: PlatformRevisionEnvelope) => Promise<void>): Promise<boolean> {
    if (!this.pendingEnvelope) return false;
    const envelope = this.pendingEnvelope;
    this.markSaving(envelope);
    try {
      await save(envelope);
      this.markSaved(envelope.revision.revisionId);
      return true;
    } catch (error) {
      this.markFailed(error);
      return false;
    }
  }

  setCompetingTab(tabId: string | null): void {
    this.update({ readOnly: tabId !== null, competingTabId: tabId });
  }

  shouldWarnBeforeUnload(): boolean {
    return this.snapshotValue.state === "saving"
      || this.snapshotValue.state === "unsaved"
      || this.snapshotValue.state === "failed";
  }

  private update(patch: Partial<EditorSessionSnapshot>): void {
    this.snapshotValue = { ...this.snapshotValue, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

export class ProjectTabLease {
  private readonly tabId = crypto.randomUUID();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly projectId: string,
    private readonly channel: BroadcastChannelLike,
    private readonly onCompetingTab: (tabId: string | null) => void,
    private readonly now: () => number = Date.now,
    private readonly heartbeatMs = 2_000,
    private readonly expiryMs = 6_000
  ) {}

  start(): () => void {
    this.channel.addEventListener("message", this.onMessage);
    this.send("claim");
    this.heartbeatTimer = setInterval(() => {
      this.send("heartbeat");
      this.prune();
    }, this.heartbeatMs);
    return () => this.stop();
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.send("release");
    this.channel.removeEventListener("message", this.onMessage);
    this.channel.close();
    this.seen.clear();
    this.onCompetingTab(null);
  }

  private readonly onMessage = (event: MessageEvent<ProjectTabLeaseMessage>): void => {
    const message = event.data;
    if (message.projectId !== this.projectId || message.tabId === this.tabId) return;
    if (message.type === "release") this.seen.delete(message.tabId);
    else this.seen.set(message.tabId, message.sentAt);
    this.prune();
  };

  private prune(): void {
    const cutoff = this.now() - this.expiryMs;
    for (const [tabId, sentAt] of this.seen) {
      if (sentAt < cutoff) this.seen.delete(tabId);
    }
    this.onCompetingTab(this.seen.keys().next().value ?? null);
  }

  private send(type: ProjectTabLeaseMessage["type"]): void {
    this.channel.postMessage({ type, projectId: this.projectId, tabId: this.tabId, sentAt: this.now() });
  }
}

export function bindBeforeUnload(
  coordinator: EditorSessionCoordinator,
  target: Pick<Window, "addEventListener" | "removeEventListener">
): () => void {
  const listener = (event: BeforeUnloadEvent): void => {
    if (!coordinator.shouldWarnBeforeUnload()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  target.addEventListener("beforeunload", listener);
  return () => target.removeEventListener("beforeunload", listener);
}
