"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useStigmer } from "../hooks";
import { parseWorkflowYaml } from "./serialize-workflow-yaml";

/** Return value of {@link useWorkflowSave}. */
export interface UseWorkflowSaveReturn {
  /**
   * Parse the YAML and call `workflow.apply()` on the server.
   * Returns `true` on success, `false` on failure (check `error`).
   */
  readonly save: (yaml: string) => Promise<boolean>;
  /** `true` while a save request is in flight. */
  readonly isSaving: boolean;
  /** Error from the last failed save, or `null` on success. */
  readonly error: Error | null;
}

/**
 * Behavior hook that persists workflow YAML to the server via `apply()`.
 *
 * Parses the YAML into a `WorkflowInput`, calls `stigmer.workflow.apply()`,
 * and returns success/failure state. Handles UNIMPLEMENTED gracefully
 * (backend not yet deployed) with a descriptive error message.
 *
 * @param org - Organization slug for the target workflow.
 *
 * @since T10 (YAML Editor with Graph Preview)
 */
export function useWorkflowSave(org: string): UseWorkflowSaveReturn {
  const stigmer = useStigmer();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const orgRef = useRef(org);
  orgRef.current = org;

  const save = useCallback(
    async (yaml: string): Promise<boolean> => {
      setIsSaving(true);
      setError(null);

      try {
        const input = parseWorkflowYaml(yaml, orgRef.current);
        await stigmer.workflow.apply(input);
        return true;
      } catch (err) {
        const wrapped =
          err instanceof Error ? err : new Error(String(err));

        if (isUnimplementedError(err)) {
          setError(
            new Error(
              "Workflow save is not yet available on this server. " +
                "The workflow was validated locally but could not be persisted.",
            ),
          );
        } else {
          setError(wrapped);
        }
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [stigmer],
  );

  return useMemo(() => ({ save, isSaving, error }), [save, isSaving, error]);
}

/**
 * Detect gRPC UNIMPLEMENTED (code 12) from a Connect error or
 * a StigmerError wrapping one. The SDK's CODE_MAP doesn't include
 * Unimplemented so it surfaces as "unknown" — check connectCode.
 */
function isUnimplementedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ("connectCode" in err && (err as { connectCode: number }).connectCode === 12) {
    return true;
  }
  const msg = (err as { message?: string }).message ?? "";
  return msg.includes("[unimplemented]") || msg.includes("UNIMPLEMENTED");
}
