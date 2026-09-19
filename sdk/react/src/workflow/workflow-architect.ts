"use client";

import { useMemo } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { useAgent } from "../agent/useAgent.js";

/**
 * The Workflow Architect: the agent every AI-assisted workflow action runs
 * against (generate, refine, fix, explain, diagnose), and the one place
 * its reference lives.
 *
 * The four flows ({@link useWorkflowArchitectFlow},
 * {@link useRefineWorkflowFlow}, {@link useExplainWorkflowFlow},
 * {@link useDiagnoseExecutionFlow}) open a Session on this agent in the
 * user's Organization. Nothing in a fresh install provides it: the agent
 * arrives with Stigmer's own plugin (stigmer/stigmer#1172). Until an agent
 * with this slug exists in the Organization, the entry points that would
 * launch a flow do not render, so a user is never offered an action that
 * dead-ends on the session create's NOT_FOUND. {@link useWorkflowArchitect}
 * is that probe, and it asks with exactly the reference the flows hand to
 * the session create, so "shown" and "works" are one lookup and cannot
 * disagree.
 *
 * Trade-off, stated: the layer stays in the SDK, dormant on an install
 * without the agent, because it is what the plugin plugs into; deleting it
 * would break `@stigmer/react`'s surface for lack of content, not for lack
 * of design.
 */

/** The slug the Workflow Architect agent is installed under. */
export const WORKFLOW_ARCHITECT_SLUG = "workflow-architect";

/**
 * The reference the flows hand to the session create: the architect in
 * the given Organization.
 */
export function workflowArchitectRef(org: string): {
  readonly org: string;
  readonly slug: string;
} {
  return { org, slug: WORKFLOW_ARCHITECT_SLUG };
}

/**
 * Whether the architect can be launched in an Organization.
 *
 * - `loading` — the probe is in flight; render nothing yet rather than an
 *   action that may vanish.
 * - `available` — the agent exists; the entry points render.
 * - `absent` — no agent under the slug, or the probe failed (a backend a
 *   page cannot reach is reported by the page itself; an AI button is the
 *   wrong place to surface it). `error` says which.
 */
export type WorkflowArchitectAvailability = "loading" | "available" | "absent";

/** Return value of {@link useWorkflowArchitect}. */
export interface UseWorkflowArchitectReturn {
  /** Whether the entry points that launch the architect should render. */
  readonly availability: WorkflowArchitectAvailability;
  /** The agent when `availability` is `available`, otherwise `null`. */
  readonly agent: Agent | null;
  /** The probe's error, when `absent` is a failure rather than a NOT_FOUND. */
  readonly error: Error | null;
}

/**
 * Data hook that answers whether the Workflow Architect exists in an
 * Organization, for the entry points that launch it.
 *
 * Pass `null` or `undefined` for `org` to skip the probe (stable `absent`),
 * the shape a host without an Organization in scope already passes to the
 * flows' consumers.
 *
 * @example
 * ```tsx
 * const architect = useWorkflowArchitect(org);
 * {architect.availability === "available" && (
 *   <button onClick={openGenerate}>Generate with AI</button>
 * )}
 * ```
 */
export function useWorkflowArchitect(
  org: string | null | undefined,
): UseWorkflowArchitectReturn {
  const { agent, isLoading, error } = useAgent(
    org ?? null,
    WORKFLOW_ARCHITECT_SLUG,
  );

  return useMemo<UseWorkflowArchitectReturn>(() => {
    if (agent !== null) {
      return { availability: "available", agent, error: null };
    }
    if (isLoading) {
      return { availability: "loading", agent: null, error: null };
    }
    return { availability: "absent", agent: null, error };
  }, [agent, isLoading, error]);
}
