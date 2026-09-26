export type StorageLevel = "ok" | "warning" | "critical" | "unknown";

export interface StorageAssessment {
  level: StorageLevel;
  usageBytes: number | null;
  quotaBytes: number | null;
  /** Share of the quota in use, 0–1, or null when the browser does not say. */
  ratio: number | null;
}

const WARNING_RATIO = 0.8;
const CRITICAL_RATIO = 0.95;
const CRITICAL_FREE_BYTES = 25 * 1024 * 1024;

export function assessStorage(usage?: number, quota?: number): StorageAssessment {
  if (!Number.isFinite(usage) || !Number.isFinite(quota) || !quota || quota <= 0) {
    return { level: "unknown", usageBytes: null, quotaBytes: null, ratio: null };
  }
  const used = Math.max(0, usage!);
  const ratio = Math.min(1, used / quota);
  const level =
    ratio >= CRITICAL_RATIO || quota - used < CRITICAL_FREE_BYTES
      ? "critical"
      : ratio >= WARNING_RATIO
        ? "warning"
        : "ok";
  return { level, usageBytes: used, quotaBytes: quota, ratio };
}

export async function estimateStorage(
  storage: Pick<StorageManager, "estimate"> | undefined = globalThis.navigator?.storage
): Promise<StorageAssessment> {
  try {
    const estimate = await storage?.estimate();
    return assessStorage(estimate?.usage, estimate?.quota);
  } catch {
    return assessStorage();
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function isQuotaError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return name === "QuotaExceededError" || /quota/i.test(message);
}

/** A save error worded for the person whose edit did not save. */
export function describeSaveError(error: unknown): string {
  if (isQuotaError(error)) {
    return "Browser storage is full. Export projects you want to keep and delete ones you no longer need, then retry.";
  }
  return error instanceof Error && error.message ? error.message : "Browser storage refused the save.";
}
