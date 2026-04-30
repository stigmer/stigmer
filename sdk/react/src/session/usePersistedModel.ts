"use client";

import { useEffect, useState } from "react";
import { useModelRegistry } from "../models";
import type { HarnessOption } from "../models/harness";

/** Options for {@link usePersistedModel}. */
export interface UsePersistedModelOptions {
  /**
   * Filter the model registry by harness before validating the stored model.
   *
   * When `"cursor"`, the persisted model is read from a cursor-specific
   * localStorage key and validated against cursor-provider models.
   * When `"native"` or omitted, the default key and registry apply.
   */
  readonly harness?: HarnessOption;
}

/** Return value of {@link usePersistedModel}. */
export type UsePersistedModelReturn = readonly [
  modelId: string | undefined,
  setModelId: (id: string) => void,
];

function storageKey(harness?: HarnessOption): string {
  return harness === "cursor"
    ? "stigmer:session:model:cursor"
    : "stigmer:session:model";
}

/**
 * Model selection with localStorage persistence.
 *
 * Restores the last selected model on mount and validates it against the
 * model registry. Invalid or removed models are silently ignored (returns
 * `undefined`). On change, persists the new selection to localStorage so
 * it survives page reloads and navigation.
 *
 * When `options.harness` is provided, the stored model is read from a
 * harness-specific key and validated against the harness-filtered registry.
 *
 * Used by both the session launcher (new session) and session page
 * (follow-up messages) to maintain a consistent model preference.
 */
export function usePersistedModel(
  options?: UsePersistedModelOptions,
): UsePersistedModelReturn {
  const harness = options?.harness;
  const { getModel } = useModelRegistry({ harness });
  const key = storageKey(harness);

  const [modelId, setModelId] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    return localStorage.getItem(key) ?? undefined;
  });

  useEffect(() => {
    if (modelId) {
      localStorage.setItem(key, modelId);
    }
  }, [modelId, key]);

  const validModelId = modelId && getModel(modelId) ? modelId : undefined;
  return [validModelId, setModelId] as const;
}
