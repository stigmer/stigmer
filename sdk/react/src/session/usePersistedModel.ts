"use client";

import { useEffect, useRef, useState } from "react";
import { useModelRegistry } from "../models";
import { parseModelKey } from "../models/registry";
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
 * Extract the plain modelId from a value that might be a compound key
 * (e.g. `"cursor/default"` → `"default"`). Returns the value unchanged
 * if it's already a plain ID.
 */
function extractPlainModelId(value: string): string {
  const parsed = parseModelKey(value);
  return parsed ? parsed.modelId : value;
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
 * Handles legacy compound keys (`"cursor/default"`) gracefully by
 * extracting the plain modelId portion before validation.
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
  const prevKeyRef = useRef(key);

  const [modelId, setModelId] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    const raw = localStorage.getItem(key);
    return raw ? extractPlainModelId(raw) : undefined;
  });

  // Re-read from localStorage when the storage key changes (harness transition).
  useEffect(() => {
    if (prevKeyRef.current === key) return;
    prevKeyRef.current = key;

    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(key);
    setModelId(raw ? extractPlainModelId(raw) : undefined);
  }, [key]);

  useEffect(() => {
    if (modelId) {
      localStorage.setItem(key, modelId);
    }
  }, [modelId, key]);

  const validModelId = modelId && getModel(modelId) ? modelId : undefined;
  return [validModelId, setModelId] as const;
}
