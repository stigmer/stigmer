"use client";

import { createContext, useContext } from "react";
import type { TaskKindDescriptor } from "./types.js";

/** Internal state held by the task kind registry context provider. */
export interface TaskKindRegistryState {
  readonly descriptors: readonly TaskKindDescriptor[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

/**
 * React context that holds the task kind registry fetched from the API.
 *
 * Populated by {@link StigmerProvider} on mount. Consumer hooks read from
 * this context instead of a static JSON import, enabling always-fresh
 * task metadata without npm package updates.
 *
 * @since T04 (Task Schema Registry)
 */
export const TaskKindRegistryContext = createContext<TaskKindRegistryState>({
  descriptors: [],
  isLoading: true,
  error: null,
  refetch: () => {},
});

/**
 * Internal hook to read the task kind registry from context.
 * @internal
 */
export function useTaskKindRegistryContext(): TaskKindRegistryState {
  return useContext(TaskKindRegistryContext);
}
