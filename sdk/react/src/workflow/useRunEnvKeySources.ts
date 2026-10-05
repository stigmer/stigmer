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
 * - `pending`: not typed, and whether the personal environment holds the
 *   key is not yet known: its key names are still being read, or the
 *   organizations that tell whether this run reads it still are;
 * - `unknown`: not typed, and that read failed, so whether the personal
 *   environment holds the key cannot be known here (the server still fills
 *   the key from it when the run is created);
 * - `missing`: not typed and known to be absent from the personal
 *   environment, or the run reads no personal environment at all, so the
 *   run has no value for it.
 *
 * It reads key names only, never values, from {@link usePersonalEnvironment}.
 * An untyped key is named `personal` or `missing` only once the answer is
 * known (that read has answered, or the run reads no personal environment),
 * so the form never names a source it later withdraws: until then the key
 * is `pending`, and after a failed read it is `unknown`. Only `missing` is
 * a known gap, and the run flow blocks on nothing else.
 *
 * Pinned by `__tests__/useRunEnvKeySources.test.tsx` and through the run
 * flow by `__tests__/useRunWorkflowFlow.test.tsx` and
 * `__tests__/WorkflowRunDialog.test.tsx`.
 */

import { useEffect, useMemo, useRef } from "react";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { usePersonalEnvironment } from "../environment/usePersonalEnvironment.js";
import { findOrgByRef, useOptionalOrg } from "../organization/OrgProvider.js";

/** Where a declared key's value comes from for a run. */
export type RunEnvKeySource =
  | "typed"
  | "personal"
  | "pending"
  | "unknown"
  | "missing";

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
  /**
   * `true` while the personal environment's key names are being read, or
   * while the organizations needed to tell whether the run reads them are.
   */
  readonly isLoading: boolean;
  /**
   * The failed read of the personal environment's key names, or `null`.
   * While set, every untyped declared key is `unknown`.
   */
  readonly error: Error | null;
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
  const orgContext = useOptionalOrg();
  const orgs = orgContext?.orgs;
  const orgsLoading = orgContext?.isLoading ?? false;
  const workflowOrg = workflow.metadata?.org ?? "";

  const readsPersonalEnvironment = useMemo(() => {
    if (!workflowOrg || !runOrg) return false;
    const idOf = (ref: string): string =>
      (orgs ? findOrgByRef(orgs, ref)?.metadata?.id : undefined) || ref;
    return idOf(workflowOrg) === idOf(runOrg);
  }, [orgs, workflowOrg, runOrg]);

  const readOrg = readsPersonalEnvironment ? runOrg : null;
  const personal = usePersonalEnvironment(readOrg);

  // A read starts in the effect after its organization is first passed;
  // until then the hook still reports the previous organization's settled
  // state, so only a read started for this organization can have answered.
  // This effect runs after the read's own, whose state change renders again.
  const readStartedFor = useRef<string | null>(null);
  useEffect(() => {
    readStartedFor.current = readOrg;
  }, [readOrg]);
  const answered =
    readOrg !== null && readStartedFor.current === readOrg && !personal.isLoading;

  // Two references to one organization (an id and a slug) match only once
  // the organizations are known, so until then the comparison is open.
  const awaitingOrgs =
    !readsPersonalEnvironment && orgsLoading && !!workflowOrg && !!runOrg;

  const isLoading = awaitingOrgs || (readsPersonalEnvironment && !answered);
  const error = answered ? personal.error : null;

  const personalData = personal.environment?.spec?.data;
  const declarations = workflow.spec?.env;

  const sources = useMemo(() => {
    const result: Record<string, RunEnvKeySource> = {};
    for (const key of Object.keys(declarations ?? {})) {
      if (runtimeEnv[key]?.trim()) {
        result[key] = "typed";
      } else if (isLoading) {
        result[key] = "pending";
      } else if (!readsPersonalEnvironment) {
        result[key] = "missing";
      } else if (error) {
        result[key] = "unknown";
      } else if (personalData && Object.hasOwn(personalData, key)) {
        result[key] = "personal";
      } else {
        result[key] = "missing";
      }
    }
    return result;
  }, [declarations, runtimeEnv, isLoading, readsPersonalEnvironment, error, personalData]);

  return useMemo(
    () => ({ sources, readsPersonalEnvironment, isLoading, error }),
    [sources, readsPersonalEnvironment, isLoading, error],
  );
}
