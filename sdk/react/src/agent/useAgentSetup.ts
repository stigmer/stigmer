"use client";

import { useCallback, useEffect, useReducer } from "react";
import { create } from "@bufbuild/protobuf";
import type { EnvVarInput, ResourceRef, Stigmer } from "@stigmer/sdk";
import { ListAgentInstancesRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/io_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { usePersonalEnvironment } from "../environment/usePersonalEnvironment.js";
import { buildPersonalInstanceInput } from "../agent-instance/buildPersonalInstanceInput.js";
import { diffEnv } from "../environment/diffEnv.js";
import {
  agentSetupReducer,
  INITIAL_STATE,
  type AgentResolution,
  type AgentSetupResult,
  type AgentSetupReadyResult,
  type AgentSetupState,
} from "./agentSetupReducer.js";

const PERSONAL_LABEL = "stigmer.ai/personal";
const FOR_AGENT_LABEL = "stigmer.ai/for-agent";

/**
 * Re-checks for an existing personal instance immediately before
 * creating one. Narrows the race window when multiple clients
 * (tabs, double-clicks) attempt to create simultaneously.
 */
async function findOrCreatePersonalInstance(
  stigmer: Stigmer,
  params: {
    org: string;
    agentId: string;
    agentSlug: string;
    agentLabel: string;
    environmentRef: ResourceRef;
  },
): Promise<AgentInstance> {
  const { org, agentId, agentSlug, agentLabel, environmentRef } = params;

  const recheck = await stigmer.agentInstance.list(
    create(ListAgentInstancesRequestSchema, {
      org,
      labels: {
        [PERSONAL_LABEL]: "true",
        [FOR_AGENT_LABEL]: agentLabel,
      },
    }),
  );

  if (recheck.items.length > 0) {
    return recheck.items[0];
  }

  return stigmer.agentInstance.create(
    buildPersonalInstanceInput({ org, agentId, agentSlug, environmentRef }),
  );
}

// ---------------------------------------------------------------------------
// Public types (re-exported from agentSetupReducer for convenience)
// ---------------------------------------------------------------------------

export type {
  AgentResolution,
  AgentSetupResult,
  AgentSetupReadyResult,
  AgentSetupState,
  AgentSetupPhase,
} from "./agentSetupReducer.js";

/** Options for {@link UseAgentSetupReturn.submitEnvVars}. */
export interface SubmitEnvVarsOptions {
  /**
   * When `true` (default), the provided values are saved to the user's
   * personal environment and a personal agent instance is created.
   * Subsequent runs of the same agent will reuse these credentials.
   *
   * When `false`, the values are collected as `runtimeEnv` for this
   * execution only — no data is persisted and no agent instance is
   * created. This path is instant (no network calls).
   *
   * @default true
   */
  readonly saveForFuture?: boolean;
}

/** Return value of {@link useAgentSetup}. */
export interface UseAgentSetupReturn {
  /**
   * Current state of the agent setup flow.
   *
   * A discriminated union on `status`:
   * - `"idle"` — no agent selected
   * - `"resolving"` — evaluating an agent's requirements
   * - `"needsEnvVars"` — waiting for user to provide missing variables
   * - `"submitting"` — saving environment / creating instance
   * - `"ready"` — agent resolved, `resolution` describes how to proceed
   *
   * `error` is available on all variants (orthogonal to phase).
   */
  readonly state: AgentSetupState;

  /**
   * Evaluate whether an agent is ready to use or needs env var collection.
   *
   * Fetches the full agent to read its `env` declarations, checks for an
   * existing personal instance, and diffs env keys against the personal
   * environment. Returns `"ready"` when the agent can be used immediately,
   * or `"needsEnvVars"` when the caller should present {@link AgentEnvForm}.
   */
  readonly resolveAgent: (ref: ResourceRef) => Promise<AgentSetupResult>;

  /**
   * Complete the env var collection flow for the pending agent.
   *
   * Behavior depends on `options.saveForFuture`:
   * - `true` (default) — Creates or updates the personal environment
   *   with the provided values, then creates a personal agent instance.
   *   Returns `{ resolution: { mode: "saved", instanceId } }`.
   * - `false` — Collects values as `runtimeEnv` without any API calls.
   *   Returns `{ resolution: { mode: "oneTime", runtimeEnv } }`.
   *
   * Must only be called when `state.status === "needsEnvVars"`.
   */
  readonly submitEnvVars: (
    values: Record<string, EnvVarInput>,
    options?: SubmitEnvVarsOptions,
  ) => Promise<AgentSetupReadyResult>;

  /**
   * Resolve the agent directly to a specific, already-existing
   * {@link AgentInstance} — bypassing the env-collection flow.
   *
   * Used by instance-management surfaces (e.g. "Start session" on a
   * specific instance) where the user has explicitly chosen which
   * configured deployment to run against. Because an AgentInstance
   * already binds its own environment(s), there is nothing to collect:
   * the chosen instance *is* the resolved `"saved"` resolution.
   *
   * This transitions the state machine straight to `"ready"` with
   * `{ mode: "saved", instanceId }`. No agent fetch and no instance
   * lookup are performed — the caller owns the instance identity.
   *
   * @param ref - Reference to the agent the instance deploys.
   * @param instanceId - ID of the agent instance to bind the session to.
   * @param agentName - Optional display name; falls back to `ref.slug`.
   */
  readonly resolveToInstance: (
    ref: ResourceRef,
    instanceId: string,
    agentName?: string,
  ) => Promise<AgentSetupReadyResult>;

  /** Clear the error without changing the current phase. */
  readonly clearError: () => void;

  /** Reset to `idle` state, clearing all phase data and errors. */
  readonly reset: () => void;
}

/**
 * Layer 2 behavior hook that encapsulates the agent selection,
 * personal environment resolution, and secret delivery routing flow.
 *
 * When a user picks an agent in the {@link AgentPicker}, this hook
 * determines whether the agent requires credentials (via its
 * `env` declarations), checks what the user has already provided in their
 * personal environment, and either reports the agent as ready or
 * identifies the missing variables so the caller can render
 * {@link AgentEnvForm}.
 *
 * The hook supports two secret delivery paths via the `saveForFuture`
 * option on {@link submitEnvVars}:
 * - **Saved** — secrets are persisted to the personal environment and
 *   a personal agent instance is created for reuse.
 * - **One-time** — secrets are returned as `runtimeEnv` for a single
 *   execution, with no data persisted.
 *
 * State is managed by a `useReducer` state machine with five phases:
 * `idle → resolving → needsEnvVars → submitting → ready`.
 *
 * Composes {@link usePersonalEnvironment} for personal environment
 * operations and calls the Stigmer client directly for agent and
 * agent instance queries.
 *
 * > **Why not compose `usePersonalAgentInstance`?**
 * > `resolveAgent` is an imperative async callback that needs
 * > immediate results within a single invocation. Hook state
 * > updates require a render cycle. Instance creation is delegated
 * > through the shared `buildPersonalInstanceInput` helper instead.
 *
 * Pass `null` as `org` to disable all operations (stable no-op).
 *
 * @param org - Organization slug. Pass `null` to disable.
 * @param poolKeys - Optional set of env-var keys already available
 *   from the session env pool (manual secrets, one-time env vars from
 *   other components). When provided, agents whose `env` keys
 *   are fully covered by `poolKeys` + personal env auto-resolve to
 *   `ready` without prompting. Reactive — when `poolKeys` changes,
 *   `needsEnvVars` is re-evaluated.
 *
 * @example
 * ```tsx
 * const { state, resolveAgent, submitEnvVars } = useAgentSetup("acme", pool.availableKeys);
 *
 * const result = await resolveAgent({ org: "acme", slug: "code-reviewer" });
 *
 * if (result.status === "needsEnvVars") {
 *   // Render AgentEnvForm with result.missingVariables
 *   // On form submit:
 *   const ready = await submitEnvVars(formValues, { saveForFuture: true });
 *   // ready.resolution.mode === "saved" | "oneTime"
 * }
 * ```
 */
export function useAgentSetup(
  org: string | null,
  poolKeys?: Set<string>,
): UseAgentSetupReturn {
  const stigmer = useStigmer();
  const personalEnv = usePersonalEnvironment(org);

  const [state, dispatch] = useReducer(agentSetupReducer, INITIAL_STATE);

  const clearError = useCallback(() => dispatch({ type: "CLEAR_ERROR" }), []);
  const reset = useCallback(() => dispatch({ type: "RESET" }), []);

  // -------------------------------------------------------------------------
  // resolveAgent
  // -------------------------------------------------------------------------

  const resolveAgent = useCallback(
    async (ref: ResourceRef): Promise<AgentSetupResult> => {
      if (!org) {
        throw new Error(
          "useAgentSetup: cannot resolve agent when org is null.",
        );
      }

      dispatch({ type: "RESOLVE_START", agentRef: ref });

      try {
        const agent = await stigmer.agent.getByReference(ref);
        const agentName = agent.metadata?.name ?? ref.slug;
        const envDeclarations = agent.spec?.env;

        // No env declarations — agent is immediately ready (direct mode).
        if (!envDeclarations || Object.keys(envDeclarations).length === 0) {
          const resolution: AgentResolution = { mode: "direct" };
          dispatch({
            type: "RESOLVE_READY",
            agentRef: ref,
            agentName,
            resolution,
          });
          return { status: "ready", agentRef: ref, agentName, resolution };
        }

        // Agent has env declarations — check for existing personal instance.
        const agentLabel = `${ref.org}/${ref.slug}`;
        const instanceList = await stigmer.agentInstance.list(
          create(ListAgentInstancesRequestSchema, {
            org,
            labels: {
              [PERSONAL_LABEL]: "true",
              [FOR_AGENT_LABEL]: agentLabel,
            },
          }),
        );

        if (instanceList.items.length > 0) {
          const resolution: AgentResolution = {
            mode: "saved",
            instanceId: instanceList.items[0].metadata!.id,
          };
          dispatch({
            type: "RESOLVE_READY",
            agentRef: ref,
            agentName,
            resolution,
          });
          return { status: "ready", agentRef: ref, agentName, resolution };
        }

        // No personal instance — diff against existing env keys + pool.
        const existingKeys = new Set(
          Object.keys(personalEnv.environment?.spec?.data ?? {}),
        );
        const personalOnlyMissing = diffEnv(envDeclarations, existingKeys);
        const missingVariables = diffEnv(envDeclarations, existingKeys, poolKeys);

        if (personalOnlyMissing.length === 0) {
          // Personal env covers all keys — create personal instance.
          const env = await personalEnv.getOrCreate();
          const envRef: ResourceRef = {
            org,
            slug: env.metadata!.slug,
            kind: ApiResourceKind.environment,
          };

          const instance = await findOrCreatePersonalInstance(stigmer, {
            org,
            agentId: agent.metadata!.id,
            agentSlug: ref.slug,
            agentLabel,
            environmentRef: envRef,
          });

          const resolution: AgentResolution = {
            mode: "saved",
            instanceId: instance.metadata!.id,
          };
          dispatch({
            type: "RESOLVE_READY",
            agentRef: ref,
            agentName,
            resolution,
          });
          return { status: "ready", agentRef: ref, agentName, resolution };
        }

        if (missingVariables.length === 0) {
          // Pool covers remaining keys — use default instance, pool
          // values flow via sessionVariables.toRuntimeEnv() at submit.
          const resolution: AgentResolution = { mode: "direct" };
          dispatch({
            type: "RESOLVE_READY",
            agentRef: ref,
            agentName,
            resolution,
          });
          return { status: "ready", agentRef: ref, agentName, resolution };
        }

        // Missing variables — transition to needsEnvVars.
        dispatch({
          type: "RESOLVE_NEEDS_ENV",
          agentRef: ref,
          agentId: agent.metadata!.id,
          agentName,
          missingVariables,
        });
        return {
          status: "needsEnvVars",
          agentRef: ref,
          agentName,
          missingVariables,
        };
      } catch (err) {
        dispatch({ type: "ERROR", error: toError(err) });
        throw err;
      }
    },
    [org, stigmer, personalEnv, poolKeys],
  );

  // -------------------------------------------------------------------------
  // resolveToInstance — bind directly to an explicitly chosen instance
  // -------------------------------------------------------------------------

  const resolveToInstance = useCallback(
    async (
      ref: ResourceRef,
      instanceId: string,
      agentName?: string,
    ): Promise<AgentSetupReadyResult> => {
      const resolution: AgentResolution = { mode: "saved", instanceId };
      const name = agentName ?? ref.slug;
      dispatch({
        type: "RESOLVE_READY",
        agentRef: ref,
        agentName: name,
        resolution,
      });
      return { status: "ready", agentRef: ref, agentName: name, resolution };
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Pool re-evaluation — auto-resolve needsEnvVars when pool changes
  // -------------------------------------------------------------------------

  const agentMissingVars =
    state.status === "needsEnvVars" ? state.missingVariables : null;

  useEffect(() => {
    if (!poolKeys || poolKeys.size === 0) return;
    if (!agentMissingVars) return;

    const stillMissing = agentMissingVars.filter(
      (v) => !poolKeys.has(v.key),
    );

    dispatch({ type: "POOL_RESOLVE", missingVariables: stillMissing });
  }, [poolKeys, agentMissingVars]);

  // -------------------------------------------------------------------------
  // submitEnvVars
  // -------------------------------------------------------------------------

  const submitEnvVars = useCallback(
    async (
      values: Record<string, EnvVarInput>,
      options?: SubmitEnvVarsOptions,
    ): Promise<AgentSetupReadyResult> => {
      if (state.status !== "needsEnvVars") {
        throw new Error(
          "useAgentSetup: submitEnvVars requires state.status === 'needsEnvVars'. " +
            `Current status is '${state.status}'. Call resolveAgent() first ` +
            "and ensure it returned status 'needsEnvVars'.",
        );
      }
      if (!org) {
        throw new Error(
          "useAgentSetup: cannot submit env vars when org is null.",
        );
      }

      const { agentRef, agentId, agentName } = state;
      const saveForFuture = options?.saveForFuture ?? true;

      // ----- One-time path: no API calls, instant result -----
      if (!saveForFuture) {
        const resolution: AgentResolution = {
          mode: "oneTime",
          runtimeEnv: values,
        };
        dispatch({
          type: "SUBMIT_READY",
          agentRef,
          agentName,
          resolution,
        });
        return { status: "ready", agentRef, agentName, resolution };
      }

      // ----- Save path: persist to environment + create instance -----
      dispatch({ type: "SUBMIT_START" });

      try {
        const env = await personalEnv.getOrCreate();
        await personalEnv.addVariables(values);

        const envRef: ResourceRef = {
          org,
          slug: env.metadata!.slug,
          kind: ApiResourceKind.environment,
        };

        const agentLabel = `${agentRef.org}/${agentRef.slug}`;
        const instance = await findOrCreatePersonalInstance(stigmer, {
          org,
          agentId,
          agentSlug: agentRef.slug,
          agentLabel,
          environmentRef: envRef,
        });

        const resolution: AgentResolution = {
          mode: "saved",
          instanceId: instance.metadata!.id,
        };
        dispatch({
          type: "SUBMIT_READY",
          agentRef,
          agentName,
          resolution,
        });
        return { status: "ready", agentRef, agentName, resolution };
      } catch (err) {
        dispatch({ type: "ERROR", error: toError(err) });
        throw err;
      }
    },
    [org, stigmer, personalEnv, state],
  );

  return { state, resolveAgent, submitEnvVars, resolveToInstance, clearError, reset };
}
