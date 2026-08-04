export interface CoalescibleGenerationStatus {
  jobId: string;
  status: string;
  updatedAt: string;
  attemptCount: number;
}

const STATUS_PRIORITY: Readonly<Record<string, number>> = {
  queued: 0,
  retryScheduled: 1,
  running: 2,
  failed: 3,
  deadLetter: 4,
  cancelled: 5,
  completed: 6
};

function priority(status: string): number {
  return STATUS_PRIORITY[status] ?? -1;
}

export function selectNewestMeaningfulStatus<T extends CoalescibleGenerationStatus>(
  current: T | undefined,
  candidate: T
): T {
  if (!current) return candidate;

  const currentTime = Date.parse(current.updatedAt);
  const candidateTime = Date.parse(candidate.updatedAt);

  if (candidateTime > currentTime) return candidate;
  if (candidateTime < currentTime) return current;
  if (candidate.attemptCount > current.attemptCount) return candidate;
  if (candidate.attemptCount < current.attemptCount) return current;
  return priority(candidate.status) >= priority(current.status) ? candidate : current;
}

export function coalesceGenerationStatuses<T extends CoalescibleGenerationStatus>(
  statuses: readonly T[]
): T[] {
  const latest = new Map<string, T>();
  for (const status of statuses) {
    latest.set(status.jobId, selectNewestMeaningfulStatus(latest.get(status.jobId), status));
  }
  return [...latest.values()].sort((left, right) => left.jobId.localeCompare(right.jobId));
}

export class AppliedGenerationJobSet {
  private readonly applied = new Set<string>();

  has(jobId: string): boolean {
    return this.applied.has(jobId);
  }

  applyOnce<T>(jobId: string, operation: () => T): T | undefined {
    if (this.applied.has(jobId)) return undefined;
    const result = operation();
    this.applied.add(jobId);
    return result;
  }
}
