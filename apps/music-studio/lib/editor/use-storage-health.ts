"use client";

import { useCallback, useEffect, useState } from "react";

import { assessStorage, estimateStorage, type StorageAssessment } from "./storage-health";

/** Current browser storage usage; call `refresh` after large writes. */
export function useStorageHealth(): { health: StorageAssessment; refresh: () => void } {
  const [health, setHealth] = useState<StorageAssessment>(() => assessStorage());
  const refresh = useCallback(() => {
    void estimateStorage().then(setHealth);
  }, []);
  useEffect(refresh, [refresh]);
  return { health, refresh };
}
