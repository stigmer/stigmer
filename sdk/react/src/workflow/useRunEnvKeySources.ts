"use client";

/**
 * Where each key a workflow declares will come from when the person starts
 * a run, so the run form can say it before the run starts.
 *
 * The server's rule for a workflow run's keys: the values passed with the
 * run (`runtime_env`) come first; then, for every declared key still
 * missing, the running person's personal environment in the run's
 * organization, and only when the workflow belongs to that organization (a
 * workflow another organization shares reads none of the person's keys).
 * This hook mirrors that order per declared key:
 *
 * - `typed`: the person typed a value, which is passed with the run;
 * - `personal`: their personal environment holds the key;
 * - `missing`: neither, so the run has no value for it.
 *
 * It reads key names only, never values, from {@link usePersonalEnvironment}.
 * While that read is in flight no key is marked personal, so the form never
 * names a source a moment later withdrawn; `isLoading` says the answer is
 * not final.
 *
 * Pinned through the run flow by `__tests__/useRunWorkflowFlow.test.tsx`
 * and `__tests__/WorkflowRunDialog.test.tsx`.
 */

import { useMemo } from "react";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { usePersonalEnvironment } from "../environment/usePersonalEnvironment.js";
import { findOrgByRef, useOptionalOrg } from "../organization/OrgProvider.js";

/** Where a declared key's value comes from for a run. */
export type RunEnvKeySource = "typed" | "personal" | "missing";

/** Return value of {@link useRunEnvKeySources}. */
export interface UseRunEnvKeySourcesReturn {
  /** The source of every key the workflow declares, keyed by key name. */
  readonly sources: Readonly<Record<string, RunEnvKeySource>>;
  /**
   * `true` when the workflow belongs to the run's organization, so the
   * person's personal environment can fill its keys; `false` for a
   * workflow another organization shares.
   */
  readonly readsPersonalEnvironment: boolean;
  /** `true` while the personal environment's key names are being read. */
  readonly isLoading: boolean;
}

/**
 * Per-key sources for a run of `workflow` started in `runOrg` (an
 * organization id, as stored resources name it, or its slug) with the
 * values in `runtimeEnv` typed so far.
 */
export function useRunEnvKeySources(
  workflow: Workflow,
  runOrg: string,
  runtimeEnv: Readonly<Record<string, string>>,
): UseRunEnvKeySourcesReturn {
  const orgs = useOptionalOrg()?.orgs;
  const workflowOrg = workflow.metadata?.org ?? "";

  const readsPersonalEnvironment = useMemo(() => {
    if (!workflowOrg || !runOrg) return false;
    const idOf = (ref: string): string =>
      (orgs ? findOrgByRef(orgs, ref)?.metadata?.id : undefined) || ref;
    return idOf(workflowOrg) === idOf(runOrg);
  }, [orgs, workflowOrg, runOrg]);

  const { environment, isLoading } = usePersonalEnvironment(
    readsPersonalEnvironment ? runOrg : null,
  );

  const personalData = environment?.spec?.data;
  const declarations = workflow.spec?.env;

  const sources = useMemo(() => {
    const result: Record<string, RunEnvKeySource> = {};
    for (const key of Object.keys(declarations ?? {})) {
      if (runtimeEnv[key]?.trim()) {
        result[key] = "typed";
      } else if (readsPersonalEnvironment && personalData && Object.hasOwn(personalData, key)) {
        result[key] = "personal";
      } else {
        result[key] = "missing";
      }
    }
    return result;
  }, [declarations, runtimeEnv, readsPersonalEnvironment, personalData]);

  return useMemo(
    () => ({
      sources,
      readsPersonalEnvironment,
      isLoading: readsPersonalEnvironment && isLoading,
    }),
    [sources, readsPersonalEnvironment, isLoading],
  );
}
