"use client";

import { useCallback } from "react";
import { useAppNavigation } from "@/domain/_shared/navigation/app-navigation";

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

const EXECUTION_PATH_RE = /^\/executions\/(.+)/;

function executionIdFromPath(pathname: string): string | null {
  return pathname.match(EXECUTION_PATH_RE)?.[1] ?? null;
}

/** True for the execution zone: a specific execution detail view. */
export function isExecutionZonePath(pathname: string): boolean {
  return EXECUTION_PATH_RE.test(pathname);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface ExecutionNavigationValue {
  /** The execution currently being viewed, or null when outside the zone. */
  readonly activeExecutionId: string | null;
  /** True when the app is in the "execution zone" (an execution detail view). */
  readonly isExecutionZone: boolean;
  /** Navigate to an execution detail view without a full page reload. */
  readonly navigateToExecution: (id: string) => void;
}

/**
 * Execution zone navigation, derived from the app-level navigation source of
 * truth (`useAppNavigation`).
 *
 * Unlike sessions, the execution zone owns no extra state — the active
 * execution id and zone flag are pure derivations of the current path, and
 * `navigateToExecution` delegates to the shared `navigate`. This is therefore
 * a plain hook (no dedicated provider), usable anywhere beneath
 * `<AppNavigationProvider>`.
 *
 * It deliberately does not interpret the `wex_*` (workflow execution) vs.
 * `aex_*` (agent execution) distinction — that routing decision belongs to the
 * rendering layer (the execution zone in the app shell), which resolves
 * `aex_*` ids to their parent session.
 */
export function useExecutionNavigation(): ExecutionNavigationValue {
  const { currentPath, navigate } = useAppNavigation();

  const isExecutionZone = isExecutionZonePath(currentPath);
  const activeExecutionId = isExecutionZone
    ? executionIdFromPath(currentPath)
    : null;

  const navigateToExecution = useCallback(
    (id: string) => {
      navigate(`/executions/${id}`);
    },
    [navigate],
  );

  return { activeExecutionId, isExecutionZone, navigateToExecution };
}
