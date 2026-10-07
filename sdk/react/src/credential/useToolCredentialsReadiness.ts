"use client";

/**
 * useToolCredentialsReadiness: whether the runs a surface with no person
 * behind it starts (a share link, a channel, a schedule, a platform
 * client) will have every value their agent needs.
 *
 * Such a run takes only what is assigned on its surface, by declarer and
 * key (`requirements.ts`, `assignmentReadiness`), so a required value with
 * no assignment refuses every run until it is assigned. The hook reads the
 * agent's requirements and names the unassigned ones, so the surface's
 * owner hears it before a visitor's first message fails.
 *
 * `applicable` is the caller's predicate (the surface serves traffic, the
 * edition runs such surfaces); the hook owns the reading.
 */
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { CredentialAssignmentInput } from "@stigmer/sdk";
import { assignmentReadiness, type Requirement } from "./requirements.js";
import { useRunRequirements } from "./useRunRequirements.js";

/**
 * Readiness of a surface's assignments for its runs:
 *
 * - `na`: the caller decided the check does not apply.
 * - `checking`: the agent's requirements are being read.
 * - `ready`: every required value is assigned.
 * - `needs-credentials`: some required values are unassigned; they are listed.
 */
export type ToolCredentialsReadiness =
  | { readonly status: "na" }
  | { readonly status: "checking" }
  | { readonly status: "ready" }
  | { readonly status: "needs-credentials"; readonly unassigned: readonly Requirement[] };

const NA: ToolCredentialsReadiness = { status: "na" };
const CHECKING: ToolCredentialsReadiness = { status: "checking" };
const READY: ToolCredentialsReadiness = { status: "ready" };

/** Options for {@link useToolCredentialsReadiness}. */
export interface ToolCredentialsReadinessOptions {
  /** Repository URLs the surface's runs clone (a schedule's workspace). */
  readonly repositoryUrls?: readonly string[];
}

/**
 * Data hook that reads whether `assignments` give `agent`'s runs every
 * required value.
 *
 * @example
 * ```tsx
 * const readiness = useToolCredentialsReadiness(enabled, agent, draft.credentials);
 * if (readiness.status === "needs-credentials") {
 *   // name readiness.unassigned
 * }
 * ```
 */
export function useToolCredentialsReadiness(
  applicable: boolean,
  agent: Agent | null,
  assignments: readonly CredentialAssignmentInput[],
  options?: ToolCredentialsReadinessOptions,
): ToolCredentialsReadiness {
  const { requirements, isLoading } = useRunRequirements(
    applicable ? agent : null,
    options,
  );
  if (!applicable || agent === null) return NA;
  if (isLoading) return CHECKING;
  const { unassigned } = assignmentReadiness(requirements, assignments);
  return unassigned.length === 0 ? READY : { status: "needs-credentials", unassigned };
}
