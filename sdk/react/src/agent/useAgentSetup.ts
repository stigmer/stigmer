"use client";

/**
 * useAgentSetup: whether a run of the picked agent can start for this
 * person, and what to ask them when it cannot.
 *
 * The reading is the server resolver's own rule, per declarer
 * (`credential/requirements.ts`, `personReadiness`): a value given for
 * this run counts first; then the agent's own keys and a repository
 * host's token come from the person's own credential serving it, else the
 * organization's they may use; an MCP server's keys come from the
 * person's own credential serving it (personal sign-in) or the
 * organization's (organization sign-in). The agent's `env` no longer
 * carries its MCP servers' keys, so each server is read on its own.
 *
 * What cannot be typed is a sign-in: a server whose key a sign-in fills
 * is a pending sign-in, and so is a server with organization sign-in that
 * the organization has not connected (an admin connects it). A sign-in
 * whose grant has expired is pending again.
 *
 * Values the person types are saved where the next run will look: into
 * their own credential serving the declarer that needs them, created and
 * named after the declarer when none serves it yet (`credential/serving.ts`).
 *
 * Pinned by `__tests__/useAgentSetup.credentials.test.tsx`,
 * `__tests__/useAgentSetup.poolResolve.test.tsx` and
 * `__tests__/useAgentSetup.signIns.test.tsx`.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { create } from "@bufbuild/protobuf";
import type { EnvVarInput, ResourceRef, Stigmer } from "@stigmer/sdk";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { GetOAuthGrantStatusInputSchema, OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { isSignInCredential, servingCredential, targetRefKey } from "../credential/model.js";
import {
  personReadiness,
  readRunRequirements,
  type Requirement,
} from "../credential/requirements.js";
import { listCredentialsForReading, saveToServingCredential } from "../credential/serving.js";
import type { EnvVarFormVariable } from "../credential/EnvVarForm.js";
import {
  agentSetupReducer,
  INITIAL_STATE,
  type AgentResolution,
  type AgentSetupResult,
  type AgentSetupReadyResult,
  type AgentSetupState,
  type PendingSignIn,
} from "./agentSetupReducer.js";

/** The server a requirement's declarer is, among the servers the agent uses. */
function serverOf(servers: readonly McpServer[], requirement: Requirement): McpServer | undefined {
  const id = requirement.declarer.mcpServerId;
  return id ? servers.find((server) => server.metadata?.id === id) : undefined;
}

/** A pending sign-in row for `server`. */
function pendingSignIn(
  server: McpServer,
  org: string,
  health: OAuthConnectionHealth,
  organization: boolean,
): PendingSignIn {
  return {
    ref: { org: server.metadata?.org || org, slug: server.metadata?.slug ?? "" },
    id: server.metadata?.id ?? "",
    name: server.metadata?.name || server.metadata?.slug || "",
    health,
    organization,
  };
}

/**
 * The sign-ins a run of the agent still needs: every server whose sign-in
 * key nobody filled (the person's own for personal sign-in), every server
 * with organization sign-in missing a value, and every server whose
 * sign-in credential is there but whose grant is no longer good. A grant
 * read that fails leaves the server pending, fail-closed, so the row
 * offers Sign in rather than pretending.
 */
async function readPendingSignIns(
  stigmer: Stigmer,
  org: string,
  servers: readonly McpServer[],
  credentials: readonly Credential[],
  readiness: ReturnType<typeof personReadiness>,
): Promise<PendingSignIn[]> {
  const pending = new Map<string, PendingSignIn>();
  const add = (requirement: Requirement, health: OAuthConnectionHealth, organization: boolean) => {
    const server = serverOf(servers, requirement);
    const id = server?.metadata?.id ?? "";
    if (!server || id === "" || pending.has(id)) return;
    pending.set(id, pendingSignIn(server, org, health, organization));
  };
  for (const requirement of readiness.signIns) {
    add(requirement, OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT, false);
  }
  for (const requirement of readiness.organization) {
    add(requirement, OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT, true);
  }
  for (const { requirement, source } of readiness.met) {
    const declarer = requirement.declarer;
    if (declarer.signInKey !== requirement.key || source === "runtime") continue;
    const owner = declarer.signIn === "organization" ? "org" : "person";
    const credential = servingCredential(credentials, declarer.target, owner);
    if (!credential || !isSignInCredential(credential) || !declarer.mcpServerId) continue;
    let health = OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT;
    let connected = false;
    try {
      const grant = await stigmer.mcpServer.getOAuthGrantStatus(
        create(GetOAuthGrantStatusInputSchema, { resourceId: declarer.mcpServerId, org }),
      );
      health = grant.connectionHealth;
      connected = grant.connected && health !== OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED;
    } catch {
      // Fail closed: an unreadable grant is a sign-in still owed.
    }
    if (!connected) add(requirement, health, declarer.signIn === "organization");
  }
  return [...pending.values()];
}

/**
 * The form rows for the values a person must give: one per key (a key two
 * declarers need is typed once and saved for both), required first, then
 * the optional keys of the same declarers so the form can offer them.
 */
function formVariables(
  missing: readonly Requirement[],
  optionalMissing: readonly Requirement[],
): EnvVarFormVariable[] {
  const declarers = new Set(missing.map((requirement) => targetRefKey(requirement.declarer.target)));
  const rows = new Map<string, EnvVarFormVariable>();
  for (const requirement of missing) {
    if (rows.has(requirement.key)) continue;
    rows.set(requirement.key, {
      key: requirement.key,
      isSecret: requirement.isSecret,
      ...(requirement.description ? { description: requirement.description } : {}),
    });
  }
  for (const requirement of optionalMissing) {
    if (rows.has(requirement.key) || !declarers.has(targetRefKey(requirement.declarer.target))) continue;
    rows.set(requirement.key, {
      key: requirement.key,
      isSecret: requirement.isSecret,
      ...(requirement.description ? { description: requirement.description } : {}),
      optional: true,
    });
  }
  return [...rows.values()];
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
   * When `true` (default), the values are saved into the person's own
   * credential serving each declarer that needs them (created, named
   * after the declarer, when none serves it yet), so later runs find them
   * without asking again.
   *
   * When `false`, the values are collected as `runtimeEnv` for this
   * run only — nothing is persisted. This path is instant (no
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
   * - `"submitting"` — saving into the person's credentials
   * - `"ready"` — agent resolved, `resolution` describes how to proceed
   *
   * `error` is available on all variants (orthogonal to phase).
   */
  readonly state: AgentSetupState;

  /**
   * Evaluate whether an agent is ready to use or needs env var collection.
   *
   * Fetches the agent and each MCP server it uses, and reads every value
   * a run needs against the person's credentials, the organization's they
   * may use, and the session's variables.
   * Returns `"ready"` when the agent can be used immediately,
   * or `"needsEnvVars"` when the caller should present {@link AgentEnvForm}.
   */
  readonly resolveAgent: (ref: ResourceRef) => Promise<AgentSetupResult>;

  /**
   * Complete the env var collection flow for the pending agent.
   *
   * Behavior depends on `options.saveForFuture`:
   * - `true` (default) — Saves each value into the person's own credential
   *   serving the declarer that needs it.
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
   * again through {@link resolveAgent}, which now finds the sign-in and
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
 * Layer 2 behaviour hook behind the composer's agent selection: reads
 * whether a run of the picked agent can start for this person, and
 * collects what it cannot start without.
 *
 * The hook supports two delivery paths via the `saveForFuture` option on
 * {@link submitEnvVars}:
 * - **Saved** — values are saved into the person's own credentials, one
 *   per declarer, where every later run reads them.
 * - **One-time** — values are returned as `runtimeEnv` for a single run,
 *   with nothing saved.
 *
 * State is managed by a `useReducer` state machine with five phases:
 * `idle → resolving → needsEnvVars → submitting → ready`.
 *
 * Pass `null` as `org` to disable all operations (stable no-op).
 *
 * @param org - Organization id (a slug is also accepted). Pass `null` to disable.
 * @param poolKeys - Optional set of env-var keys already available
 *   from the session env pool (manual secrets, one-time env vars from
 *   other components). When provided, agents whose missing values
 *   are all covered by `poolKeys` auto-resolve to `ready` without
 *   prompting. Reactive — when `poolKeys` changes,
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

  const [state, dispatch] = useReducer(agentSetupReducer, INITIAL_STATE);

  // The requirements behind the form's rows, kept for the save: a typed
  // key goes into the credential serving each declarer that needs it.
  const missingRef = useRef<readonly Requirement[]>([]);

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
        const { requirements, servers } = await readRunRequirements(stigmer, agent);

        if (requirements.length === 0) {
          missingRef.current = [];
          const resolution: AgentResolution = { mode: "direct" };
          dispatch({ type: "RESOLVE_READY", agentRef: ref, agentName, resolution });
          return { status: "ready", agentRef: ref, agentName, resolution };
        }

        const credentials = await listCredentialsForReading(stigmer, org);
        const readiness = personReadiness(requirements, { credentials, runtimeKeys: poolKeys });
        const pendingSignIns = await readPendingSignIns(stigmer, org, servers, credentials, readiness);
        const missingVariables = formVariables(readiness.missing, readiness.optionalMissing);
        missingRef.current = [...readiness.missing, ...readiness.optionalMissing];

        if (pendingSignIns.length > 0 || readiness.missing.length > 0) {
          dispatch({
            type: "RESOLVE_NEEDS_ENV",
            agentRef: ref,
            agentId: agent.metadata!.id,
            agentName,
            missingVariables,
            pendingSignIns,
          });
          return { status: "needsEnvVars", agentRef: ref, agentName, missingVariables, pendingSignIns };
        }

        // Ready: "saved" when credentials give every value, "direct" when
        // this run's own values cover some of them.
        const fromRuntime = readiness.met.some(({ source }) => source === "runtime");
        const resolution: AgentResolution = { mode: fromRuntime ? "direct" : "saved" };
        dispatch({ type: "RESOLVE_READY", agentRef: ref, agentName, resolution });
        return { status: "ready", agentRef: ref, agentName, resolution };
      } catch (err) {
        dispatch({ type: "ERROR", error: toError(err) });
        throw err;
      }
    },
    [org, stigmer, poolKeys],
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
    // holds the system keys, so this effect runs for every agent with a
    // value missing.
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

      // ----- Save path: into the person's credential serving each declarer -----
      dispatch({ type: "SUBMIT_START" });

      try {
        const byDeclarer = new Map<string, { requirement: Requirement; values: Record<string, EnvVarInput> }>();
        for (const requirement of missingRef.current) {
          const value = values[requirement.key];
          if (value === undefined || value.value === "") continue;
          const key = targetRefKey(requirement.declarer.target);
          const entry = byDeclarer.get(key) ?? { requirement, values: {} };
          entry.values[requirement.key] = value;
          byDeclarer.set(key, entry);
        }
        for (const { requirement, values: declared } of byDeclarer.values()) {
          await saveToServingCredential(stigmer, {
            org,
            target: requirement.declarer.target,
            name: requirement.declarer.name,
            values: declared,
          });
        }

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
    [org, stigmer, state],
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
