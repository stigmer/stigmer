"use client";

import { useCallback } from "react";
import { useAppNavigation } from "@/domain/_shared/navigation/app-navigation";

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

const EXECUTION_PATH_RE = /^\/runs\/(.+)/;

function executionIdFromPath(pathname: string): string | null {
  return pathname.match(EXECUTION_PATH_RE)?.[1] ?? null;
}

/** True for the run zone: a specific run detail view. */
export function isRunZonePath(pathname: string): boolean {
  return EXECUTION_PATH_RE.test(pathname);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface ExecutionNavigationValue {
  /** The run currently being viewed, or null when outside the zone. */
  readonly activeRunId: string | null;
  /** True when the app is in the "execution zone" (a run detail view). */
  readonly isExecutionZone: boolean;
  /** Navigate to a run detail view without a full page reload. */
  readonly navigateToRun: (id: string) => void;
}

/**
 * Run zone navigation, derived from the app-level navigation source of
 * truth (`useAppNavigation`).
 *
 * Unlike sessions, the run zone owns no extra state — the active
 * run id and zone flag are pure derivations of the current path, and
 * `navigateToRun` delegates to the shared `navigate`. This is therefore
 * a plain hook (no dedicated provider), usable anywhere beneath
 * `<AppNavigationProvider>`.
 *
 * It deliberately does not interpret the `wex_*` (workflow run) vs.
 * `aex_*` (agent run) distinction — that routing decision belongs to the
 * rendering layer (the run zone in the app shell), which resolves
 * `aex_*` ids to their parent session.
 */
export function useRunNavigation(): ExecutionNavigationValue {
  const { currentPath, navigate } = useAppNavigation();

  const isExecutionZone = isRunZonePath(currentPath);
  const activeRunId = isExecutionZone
    ? executionIdFromPath(currentPath)
    : null;

  const navigateToRun = useCallback(
    (id: string) => {
      navigate(`/runs/${id}`);
    },
    [navigate],
  );

  return { activeRunId, isExecutionZone, navigateToRun };
}
