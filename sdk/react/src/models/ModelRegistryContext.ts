"use client";

import { createContext, useContext } from "react";
import type { ModelInfo } from "./registry.js";

/** Internal state held by the model registry context provider. */
export interface ModelRegistryState {
  readonly models: readonly ModelInfo[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  /** Retry fetching the model registry. No-op while a fetch is in flight. */
  readonly refetch: () => void;
}

/**
 * React context that holds the model registry fetched from the public API.
 *
 * Populated by {@link StigmerProvider} on mount. Consumer hooks read from
 * this context instead of a static JSON import, enabling always-fresh
 * model data without npm package updates.
 */
export const ModelRegistryContext = createContext<ModelRegistryState>({
  models: [],
  isLoading: true,
  error: null,
  refetch: () => {},
});

/**
 * Internal hook to read the model registry from context.
 * Throws if called outside a StigmerProvider.
 */
export function useModelRegistryContext(): ModelRegistryState {
  return useContext(ModelRegistryContext);
}
