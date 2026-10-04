"use client";

import { useCallback, useEffect, useReducer } from "react";
import { create } from "@bufbuild/protobuf";
import type { EnvVarInput, ResourceRef, Stigmer } from "@stigmer/sdk";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { GetOAuthGrantStatusInputSchema, OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { usePersonalEnvironment } from "../environment/usePersonalEnvironment.js";
import { useOrganizationId } from "./usePersonalKeys.js";
import { diffEnv } from "../environment/diffEnv.js";
import {
  agentSetupReducer,
  INITIAL_STATE,
  type AgentResolution,
  type AgentSetupResult,
  type AgentSetupReadyResult,
  type AgentSetupState,
  type PendingSignIn,
} from "./agentSetupReducer.js";

/** What the agent's OAuth servers say about its readiness. */
interface OAuthServerReadings {
  /** The servers nobody in the organization has signed in to. */
  readonly pendingSignIns: PendingSignIn[];
  /**
   * Every `spec.auth.targetEnvVar` among the agent's servers, connected or
   * not: the variables a sign-in fills and the composer never asks for.
   */
  readonly signInVariables: ReadonlySet<string>;
}

/**
 * Reads the agent's OAuth servers once. The rule is the composer's own MCP
 * path's (`useMcpServerSetup`): a server whose `spec.auth.targetEnvVar` is
 * set is satisfied by a connected grant; a grant read that fails leaves it
 * pending, fail-closed, so the row offers Sign in rather than pretending; a
 * server that cannot be read is the resolution's error, thrown to the
 * caller's catch.
 */
async function readOAuthServers(stigmer: Stigmer, org: string, agent: Agent): Promise<OAuthServerReadings> {
  const pendingSignIns: PendingSignIn[] = [];
  const signInVariables = new Set<string>();
  for (const usage of agent.spec?.mcpServerUsages ?? []) {
    const ref = usage.mcpServerRef;
    if (!ref) continue;
    const server = await stigmer.mcpServer.getByReference(ref);
    const auth = server.spec?.auth;
    const id = server.metadata?.id ?? "";
    if (!auth?.targetEnvVar || id === "") continue;
    signInVariables.add(auth.targetEnvVar);
    let health = OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT;
    let connected = false;
    try {
      const grant = await stigmer.mcpServer.getOAuthGrantStatus(
        create(GetOAuthGrantStatusInputSchema, { resourceId: id, org }),
      );
      health = grant.connectionHealth;
      connected = grant.connected && health !== OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED;
    } catch {
      // Fail closed: an unreadable grant is a sign-in still owed.
    }
    if (connected) continue;
    pendingSignIns.push({
      ref: { org: ref.org || server.metadata?.org || org, slug: ref.slug || server.metadata?.slug || "" },
      id,
      name: server.metadata?.name || server.metadata?.slug || ref.slug,
      health,
    });
  }
  return { pendingSignIns, signInVariables };
}

/**
 * The declarations the composer may ask the user to type.
 *
 * The server's MergeMcpServerEnvSpecs step copies every referenced MCP
 * server's `env` onto the agent at save, the OAuth token variable included,
 * so the agent's schema is complete for execution. That variable is filled
 * by a grant: execution injects it from the server-managed OAuth
 * environment, never from a value the user owns. Without a grant it is a
 * Sign in row; with one it is satisfied. Either way it is not a form field,
 * and an agent whose only declarations are such variables is as ready as
 * one that declares nothing.
 */
function typedDeclarations(
  envDeclarations: Record<string, EnvVarDeclaration>,
  signInVariables: ReadonlySet<string>,
): Record<string, EnvVarDeclaration> {
  if (signInVariables.size === 0) return envDeclarations;
  return Object.fromEntries(Object.entries(envDeclarations).filter(([key]) => !signInVariables.has(key)));
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
  PendingSignIn,
} from "./agentSetupReducer.js";

/** Options for {@link UseAgentSetupReturn.submitEnvVars}. */
export interface SubmitEnvVarsOptions {
  /**
   * When `true` (default), the provided values are saved to the user's
   * personal environment. Every run of an agent the user starts reads
   * the keys that agent declares from there, so later conversations
   * reuse them without asking again.
   *
   * When `false`, the values are collected as `runtimeEnv` for this
   * execution only — nothing is persisted. This path is instant (no
   * network calls).
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
   * - `"submitting"` — saving to the personal environment
   * - `"ready"` — agent resolved, `resolution` describes how to proceed
   *
   * `error` is available on all variants (orthogonal to phase).
   */
  readonly state: AgentSetupState;

  /**
   * Evaluate whether an agent is ready to use or needs env var collection.
   *
   * Fetches the full agent to read its `env` declarations and diffs them
   * against the personal environment and the session's variables.
   * Returns `"ready"` when the agent can be used immediately,
   * or `"needsEnvVars"` when the caller should present {@link AgentEnvForm}.
   */
  readonly resolveAgent: (ref: ResourceRef) => Promise<AgentSetupResult>;

  /**
   * Complete the env var collection flow for the pending agent.
   *
   * Behavior depends on `options.saveForFuture`:
   * - `true` (default) — Creates or updates the personal environment
   *   with the provided values.
   *   Returns `{ resolution: { mode: "saved" } }`.
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
   * Record that one of the pending sign-ins completed (the row's own
   * OAuth flow landed). When it was the last one, the agent is resolved
   * again through {@link resolveAgent}, which now finds the grant and
   * lands in `ready` or in `needsEnvVars` for its variables alone.
   *
   * Must only be called when `state.status === "needsEnvVars"`.
   */
  readonly signInCompleted: (mcpServerId: string) => Promise<void>;

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
 * - **Saved** — secrets are persisted to the personal environment,
 *   where every run of an agent the user starts reads the keys the
 *   agent declares.
 * - **One-time** — secrets are returned as `runtimeEnv` for a single
 *   execution, with no data persisted.
 *
 * State is managed by a `useReducer` state machine with five phases:
 * `idle → resolving → needsEnvVars → submitting → ready`.
 *
 * Composes {@link usePersonalEnvironment} for personal environment
 * operations and calls the Stigmer client directly for the agent and
 * its MCP servers.
 *
 * Pass `null` as `org` to disable all operations (stable no-op).
 *
 * @param org - Organization id (a slug is also accepted). Pass `null` to disable.
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
  const orgId = useOrganizationId(org ?? "");

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

        // Sign-ins first: an agent whose OAuth server has no grant is not
        // ready however its variables stand. Nothing is created here; when
        // the last sign-in lands, `signInCompleted` resolves again and the
        // branches below run with the grant in place. The variables those
        // sign-ins fill leave the declarations here and are never typed.
        const { pendingSignIns, signInVariables } = await readOAuthServers(stigmer, org, agent);
        const envDeclarations = agent.spec?.env ? typedDeclarations(agent.spec.env, signInVariables) : undefined;
        if (pendingSignIns.length > 0) {
          const existingKeys = new Set(
            Object.keys(personalEnv.environment?.spec?.data ?? {}),
          );
          const missingVariables = envDeclarations
            ? diffEnv(envDeclarations, existingKeys, poolKeys)
            : [];
          dispatch({
            type: "RESOLVE_NEEDS_ENV",
            agentRef: ref,
            agentId: agent.metadata!.id,
            agentName,
            missingVariables,
            pendingSignIns,
          });
          return {
            status: "needsEnvVars",
            agentRef: ref,
            agentName,
            missingVariables,
            pendingSignIns,
          };
        }

        // No env declarations — agent is immediately ready (direct mode).
        // Nor is anything asked of an agent of another organization: a run
        // reads none of the person's keys for it, so a key saved here
        // would never reach it.
        if (
          !envDeclarations ||
          Object.keys(envDeclarations).length === 0 ||
          (agent.metadata?.org ?? "") !== orgId
        ) {
          const resolution: AgentResolution = { mode: "direct" };
          dispatch({
            type: "RESOLVE_READY",
            agentRef: ref,
            agentName,
            resolution,
          });
          return { status: "ready", agentRef: ref, agentName, resolution };
        }

        // The agent declares keys. Each run reads them from the person's
        // personal environment, so keys already saved there need nothing.
        const existingKeys = new Set(
          Object.keys(personalEnv.environment?.spec?.data ?? {}),
        );
        const personalOnlyMissing = diffEnv(envDeclarations, existingKeys);
        const missingVariables = diffEnv(envDeclarations, existingKeys, poolKeys);

        if (personalOnlyMissing.length === 0) {
          const resolution: AgentResolution = { mode: "saved" };
          dispatch({
            type: "RESOLVE_READY",
            agentRef: ref,
            agentName,
            resolution,
          });
          return { status: "ready", agentRef: ref, agentName, resolution };
        }

        if (missingVariables.length === 0) {
          // The session's variables cover the remaining keys; their
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
          pendingSignIns: [],
        });
        return {
          status: "needsEnvVars",
          agentRef: ref,
          agentName,
          missingVariables,
          pendingSignIns: [],
        };
      } catch (err) {
        dispatch({ type: "ERROR", error: toError(err) });
        throw err;
      }
    },
    [org, orgId, stigmer, personalEnv, poolKeys],
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

    // Dispatch only when the pool covered something. The reducer stores the
    // array it is given, so dispatching an unchanged list would hand this
    // effect a new dependency and run it again, without end: the pool always
    // holds the system keys, so this effect runs for every agent that
    // declares a variable the personal environment lacks.
    if (stillMissing.length === agentMissingVars.length) return;

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
      if (state.pendingSignIns.length > 0) {
        throw new Error(
          "useAgentSetup: submitEnvVars requires every pending sign-in to have completed. " +
            `Still pending: ${state.pendingSignIns.map((signIn) => signIn.name).join(", ")}. ` +
            "Call signInCompleted(id) as each lands; the agent is resolved again when the last one does.",
        );
      }

      const { agentRef, agentName } = state;
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

      // ----- Save path: persist to the personal environment -----
      dispatch({ type: "SUBMIT_START" });

      try {
        await personalEnv.getOrCreate();
        await personalEnv.addVariables(values);

        const resolution: AgentResolution = { mode: "saved" };
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
    [org, personalEnv, state],
  );

  const signInCompleted = useCallback(
    async (mcpServerId: string): Promise<void> => {
      if (state.status !== "needsEnvVars") return;
      const remaining = state.pendingSignIns.filter((signIn) => signIn.id !== mcpServerId);
      if (remaining.length === state.pendingSignIns.length) return;
      dispatch({ type: "SIGN_IN_COMPLETED", id: mcpServerId });
      if (remaining.length === 0) {
        try {
          await resolveAgent(state.agentRef);
        } catch {
          // resolveAgent dispatched the error; the panel shows it.
        }
      }
    },
    [state, resolveAgent],
  );

  return { state, resolveAgent, submitEnvVars, signInCompleted, clearError, reset };
}
