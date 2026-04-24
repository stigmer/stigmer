"use client";

import { useEffect, useState } from "react";
import { useModelRegistry } from "../models";

const STORAGE_KEY_MODEL = "stigmer:session:model";

/** Return value of {@link usePersistedModel}. */
export type UsePersistedModelReturn = readonly [
  modelId: string | undefined,
  setModelId: (id: string) => void,
];

/**
 * Model selection with localStorage persistence.
 *
 * Restores the last selected model on mount and validates it against the
 * model registry. Invalid or removed models are silently ignored (returns
 * `undefined`). On change, persists the new selection to localStorage so
 * it survives page reloads and navigation.
 *
 * Used by both the session launcher (new session) and session page
 * (follow-up messages) to maintain a consistent model preference.
 */
export function usePersistedModel(): UsePersistedModelReturn {
  const { getModel } = useModelRegistry();

  const [modelId, setModelId] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    return localStorage.getItem(STORAGE_KEY_MODEL) ?? undefined;
  });

  useEffect(() => {
    if (modelId) {
      localStorage.setItem(STORAGE_KEY_MODEL, modelId);
    }
  }, [modelId]);

  const validModelId = modelId && getModel(modelId) ? modelId : undefined;
  return [validModelId, setModelId] as const;
}
