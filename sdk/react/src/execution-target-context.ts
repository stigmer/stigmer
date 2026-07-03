"use client";

import { createContext, useContext } from "react";
import type { ExecutionTargetOption } from "./session/execution-target.js";

/**
 * React context for the app-level execution target.
 *
 * Separated from the provider to mirror the `DeploymentModeContext`
 * pattern and avoid circular imports.
 *
 * `undefined` means no explicit target was configured at the provider
 * level -- the server decides based on deployment context.
 */
export const ExecutionTargetContext = createContext<
  ExecutionTargetOption | undefined
>(undefined);

/**
 * Read the app-level execution target from the nearest
 * `StigmerProvider`.
 *
 * Returns `"local"`, `"cloud"`, or `undefined` when the provider
 * does not specify one (server decides).
 *
 * Hooks like `useNewSessionFlow` and `useCreateSession` read this
 * to apply a consistent execution target across all sessions without
 * requiring per-call configuration.
 */
export function useExecutionTarget(): ExecutionTargetOption | undefined {
  return useContext(ExecutionTargetContext);
}
