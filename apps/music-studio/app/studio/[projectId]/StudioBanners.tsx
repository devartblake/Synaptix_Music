"use client";

import { Button } from "../../../components/ui/StudioControls";
import type { RecoveryEntry } from "../../../lib/editor/recovery-journal";

/** Recovery, failed-save, storage-full and other-tab notices above the studio. */
export function StudioBanners({ recovery, readOnly, saveFailed, saveError, storageLevel, onRestore, onDiscard, onRetrySave }: {
  recovery: RecoveryEntry | null;
  readOnly: boolean;
  saveFailed: boolean;
  saveError: string | null | undefined;
  storageLevel: string;
  onRestore: (entry: RecoveryEntry) => void;
  onDiscard: () => void;
  onRetrySave: () => void;
}) {
  return <>
    {recovery && !readOnly && (
      <section className="conflict-banner" role="status">
        <strong>Unsaved changes were recovered</strong>
        <p style={{ margin: "6px 0" }}>
          Edits from {new Date(recovery.journaledAt).toLocaleString()} didn’t finish saving before
          the studio closed. Restore them to continue from there, or discard them to keep the
          project as it was last saved.
        </p>
        <Button onClick={() => onRestore(recovery)}>Restore changes</Button>{" "}
        <Button onClick={onDiscard}>Discard</Button>
      </section>
    )}
    {saveFailed && (
      <section className="conflict-banner" role="alert">
        <strong>Your latest changes aren’t saved</strong>
        <p style={{ margin: "6px 0" }}>
          {saveError ?? "Browser storage refused the save."} Keep this tab open, then retry.
          Your edits are still here.
        </p>
        <Button onClick={onRetrySave}>Retry save</Button>
      </section>
    )}
    {(storageLevel === "warning" || storageLevel === "critical") && !saveFailed && (
      <section className="conflict-banner" role="status">
        <strong>{storageLevel === "critical" ? "Browser storage is almost full" : "Browser storage is getting full"}</strong>
        <p style={{ margin: "6px 0" }}>
          New edits may stop saving. From the project list, export projects you want to keep and
          delete ones you no longer need.
        </p>
      </section>
    )}
    {readOnly && (
      <section className="conflict-banner" role="status">
        <strong>This project is open in another tab</strong>
        <p style={{ margin: "6px 0" }}>
          Editing is paused here so the two tabs can’t overwrite each other. Close the other
          tab to keep editing in this one.
        </p>
      </section>
    )}
  </>;
}
