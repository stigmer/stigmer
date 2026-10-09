"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { create } from "@bufbuild/protobuf";
import type { ResourceRef, Stigmer } from "@stigmer/sdk";
import type { EnvVarInput } from "../vault/types.js";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { GetOAuthGrantStatusInputSchema, OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useMyVault } from "../vault/useMyVault.js";
import { valuesOf } from "../vault/types.js";
import { toolLoginKeyOf, vaultLoginServes } from "../vault/address.js";
import { MY_VAULT_ONLY, conversationVaultsKey, type ConversationVaults } from "../vault/conversationVaults.js";
import { useOrganizationId } from "./usePersonalKeys.js";
import { diffEnv } from "../vault/diffEnv.js";
import {
  agentSetupReducer,
  INITIAL_STATE,
  type AgentResolution,
  type AgentSetupResult,
  type AgentSetupReadyResult,
  type AgentSetupState,
  type PendingSignIn,
} from "./agentSetupReducer.js";

/** What the agent's MCP servers say about its readiness. */
interface ServerReadings {
  /** Every MCP server the agent uses, as read. */
  readonly servers: McpServer[];
  /** The servers nobody in the organization has signed in to. */
  readonly pendingSignIns: PendingSignIn[];
  /**
   * Every `spec.auth.targetEnvVar` among the agent's servers, connected or
   * not: the variables a sign-in fills and the composer never asks for.
   */
  readonly signInVariables: ReadonlySet<string>;
}

/**
 * Reads the agent's MCP servers once, and judges its OAuth servers. The
 * rule is the composer's own MCP path's (`useMcpServerSetup`): a server
 * whose `spec.auth.targetEnvVar` is set is satisfied by a login in a vault
 * the run reads; a grant read that fails leaves it pending, fail-closed, so
 * the row offers Sign in rather than pretending; a server that cannot be
 * read is the resolution's error, thrown to the caller's catch.
 *
 * `readVaults` are the vaults the run reads, as the person can see them
 * (My vault first when the conversation includes it, then the listed
 * vaults); a login in any of them that serves the server counts
 * ({@link vaultLoginServes}). `readsMyVault` says whether My vault's grant
 * is consulted too: it reports only a sign-in made for that very server,
 * and a grant whose token expired keeps the server pending whatever else
 * holds a login, because the run meets that sign-in in My vault first.
 * Every sign-in still owed is saved in My vault.
 */
async function readServers(
  stigmer: Stigmer,
  org: string,
  agent: Agent,
  readVaults: readonly Vault[],
  readsMyVault: boolean,
): Promise<ServerReadings> {
  const servers: McpServer[] = [];
  const pendingSignIns: PendingSignIn[] = [];
  const signInVariables = new Set<string>();
  for (const usage of agent.spec?.mcpServerUsages ?? []) {
    const ref = usage.mcpServerRef;
    if (!ref) continue;
    const server = await stigmer.mcpServer.getByReference(ref);
    servers.push(server);
    const auth = server.spec?.auth;
    const id = server.metadata?.id ?? "";
    if (!auth?.targetEnvVar || id === "") continue;
    signInVariables.add(auth.targetEnvVar);
    let health = OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT;
    let granted = false;
    if (readsMyVault) {
      try {
        const grant = await stigmer.mcpServer.getOAuthGrantStatus(
          create(GetOAuthGrantStatusInputSchema, { resourceId: id, org }),
        );
        health = grant.connectionHealth;
        granted = grant.connected;
      } catch {
        // Fail closed: an unreadable grant is a sign-in still owed.
      }
    }
    const connected =
      (granted || readVaults.some((vault) => vaultLoginServes(vault.spec?.connections ?? {}, server))) &&
      health !== OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED;
    if (connected) continue;
    pendingSignIns.push({
      ref: { org: ref.org || server.metadata?.org || org, slug: ref.slug || server.metadata?.slug || "" },
      id,
      name: server.metadata?.name || server.metadata?.slug || ref.slug,
      health,
    });
  }
  return { servers, pendingSignIns, signInVariables };
}

/** The vaults among `refs` this person can read; the others their run cannot use. */
async function readableVaults(stigmer: Stigmer, refs: readonly ResourceRef[]): Promise<Vault[]> {
  const vaults: Vault[] = [];
  for (const ref of refs) {
    try {
      vaults.push(await stigmer.vault.getByReference(ref));
    } catch {
      // A vault this person cannot read is one their run cannot use.
    }
  }
  return vaults;
}

/** The keys `vaults` fill: their secret names, and the login key of each of `servers` a login of theirs serves. */
function keysHeldBy(vaults: readonly Vault[], servers: readonly McpServer[]): Set<string> {
  const keys = new Set<string>();
  for (const vault of vaults) {
    for (const name of Object.keys(vault.spec?.secrets ?? {})) keys.add(name);
    for (const server of servers) {
      const loginKey = toolLoginKeyOf(server);
      if (loginKey && vaultLoginServes(vault.spec?.connections ?? {}, server)) keys.add(loginKey);
    }
  }
  return keys;
}

/**
 * The declarations the composer may ask the user to type.
 *
 * The server's MergeMcpServerEnvSpecs step copies every referenced MCP
 * server's `env` onto the agent at save, the OAuth token variable included,
 * so the agent's schema is complete for run. That variable is filled
 * by a sign-in: a run fills it from the login saved at the server's
 * address, never from a value typed here. Without a grant it is a
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

/** Return value of {@link useAgentSetup}. */
export interface UseAgentSetupReturn {
  /**
   * Current state of the agent setup flow.
   *
   * A discriminated union on `status`:
   * - `"idle"` — no agent selected
   * - `"resolving"` — evaluating an agent's requirements
   * - `"needsEnvVars"` — waiting for user to provide missing variables
   * - `"submitting"` — saving in My vault
   * - `"ready"` — agent resolved, `resolution` describes how to proceed
   *
   * `error` is available on all variants (orthogonal to phase).
   */
  readonly state: AgentSetupState;

  /**
   * Evaluate whether an agent is ready to use or needs env var collection.
   *
   * Fetches the full agent to read its `env` declarations and diffs them
   * against the user's vaults and the session's variables.
   * Returns `"ready"` when the agent can be used immediately,
   * or `"needsEnvVars"` when the caller should present {@link AgentEnvForm}.
   * A resolution that a newer one (or {@link reset}) overtakes still returns
   * its answer, but leaves `state` to the newer one.
   */
  readonly resolveAgent: (ref: ResourceRef) => Promise<AgentSetupResult>;

  /**
   * Complete the env var collection flow for the pending agent: the values
   * are saved in My vault, the one place a value the person types goes,
   * and the agent resolves as `{ mode: "saved" }`. A conversation reads
   * them when it includes My vault; the composer includes it for the
   * person who may change the conversation's vaults.
   *
   * Must only be called when `state.status === "needsEnvVars"`.
   */
  readonly submitEnvVars: (
    values: Record<string, EnvVarInput>,
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
 * vault resolution, and secret delivery routing flow.
 *
 * When a user picks an agent in the {@link AgentPicker}, this hook
 * determines whether the agent requires credentials (via its
 * `env` declarations), checks what the user has already saved in their
 * vaults, and either reports the agent as ready or
 * identifies the missing variables so the caller can render
 * {@link AgentEnvForm}.
 *
 * A value the person types is saved in My vault ({@link submitEnvVars});
 * a conversation never carries values of its own.
 *
 * State is managed by a `useReducer` state machine with five phases:
 * `idle → resolving → needsEnvVars → submitting → ready`.
 *
 * Composes {@link useMyVault} for My vault
 * operations and calls the Stigmer client directly for the agent and
 * its MCP servers.
 *
 * Pass `null` as `org` to disable all operations (stable no-op).
 *
 * @param org - Organization id (a slug is also accepted). Pass `null` to disable.
 * @param poolKeys - Optional set of env-var keys filled elsewhere (the
 *   platform's own keys, which the runner sets). Agents whose `env` keys
 *   are fully covered by `poolKeys` and the vaults the run reads
 *   auto-resolve to `ready` without prompting. Reactive — when `poolKeys`
 *   changes, `needsEnvVars` is re-evaluated.
 * @param conversationVaults - The vaults the conversation uses (its
 *   sender's My vault when included, then the listed vaults). Only what
 *   they hold counts as saved, and My vault's sign-in grant counts only
 *   when My vault is included. Omitted, the run is taken to read My vault
 *   alone. Reactive — when the choice changes, an agent already resolved
 *   is resolved again over it.
 *
 * @example
 * ```tsx
 * const { state, resolveAgent, submitEnvVars } = useAgentSetup("acme");
 *
 * const result = await resolveAgent({ org: "acme", slug: "code-reviewer" });
 *
 * if (result.status === "needsEnvVars") {
 *   // Render AgentEnvForm with result.missingVariables
 *   // On form submit, the values are saved in My vault:
 *   const ready = await submitEnvVars(formValues);
 *   // ready.resolution.mode === "saved"
 * }
 * ```
 */
export function useAgentSetup(
  org: string | null,
  poolKeys?: Set<string>,
  conversationVaults: ConversationVaults = MY_VAULT_ONLY,
): UseAgentSetupReturn {
  const stigmer = useStigmer();
  const myVault = useMyVault(org);
  const orgId = useOrganizationId(org ?? "");
  // Keyed by content: hosts pass a fresh choice per render, and the
  // callbacks below must not churn with it.
  const vaultsKey = conversationVaultsKey(conversationVaults);
  const choice = useMemo<ConversationVaults>(() => conversationVaults, [vaultsKey]);

  const [state, dispatch] = useReducer(agentSetupReducer, INITIAL_STATE);

  // The latest resolution's number. An answer that lands after a newer
  // resolution started (the vault pick changed meanwhile) or after a reset
  // judged vaults that no longer apply, so it never reaches the state.
  const resolutionRef = useRef(0);

  const clearError = useCallback(() => dispatch({ type: "CLEAR_ERROR" }), []);
  const reset = useCallback(() => {
    resolutionRef.current += 1;
    dispatch({ type: "RESET" });
  }, []);

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
      const turn = ++resolutionRef.current;
      const settle: typeof dispatch = (action) => {
        if (turn === resolutionRef.current) dispatch(action);
      };

      const coveredKeys = new Set(poolKeys ?? []);

      try {
        const agent = await stigmer.agent.getByReference(ref);
        const agentName = agent.metadata?.name ?? ref.slug;

        // Sign-ins first: an agent whose OAuth server has no grant is not
        // ready however its variables stand. Nothing is created here; when
        // the last sign-in lands, `signInCompleted` resolves again and the
        // branches below run with the grant in place. The variables those
        // sign-ins fill leave the declarations here and are never typed.
        // The run reads exactly the vaults the conversation uses, read
        // once here for its logins and its secret names alike: My vault
        // first when included, unless the agent is of another
        // organization, whose runs never read it; then the listed vaults.
        const foreign = (agent.metadata?.org ?? "") !== orgId;
        const readsMyVault = choice.includeMyVault && !foreign;
        const listed = await readableVaults(
          stigmer,
          choice.vaults.map((v) => ({ org: v.org || org, slug: v.slug })),
        );
        const readVaults = readsMyVault && myVault.vault !== null ? [myVault.vault, ...listed] : listed;
        const { servers, pendingSignIns, signInVariables } = await readServers(
          stigmer,
          org,
          agent,
          readVaults,
          readsMyVault,
        );
        const envDeclarations = agent.spec?.env ? typedDeclarations(agent.spec.env, signInVariables) : undefined;
        if (pendingSignIns.length > 0) {
          const existingKeys = keysHeldBy(readVaults, servers);
          const missingVariables = envDeclarations
            ? diffEnv(envDeclarations, existingKeys, coveredKeys)
            : [];
          settle({
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
        // never reads My vault for it, so a key saved here would never
        // reach it.
        if (!envDeclarations || Object.keys(envDeclarations).length === 0 || foreign) {
          const resolution: AgentResolution = { mode: "direct" };
          settle({
            type: "RESOLVE_READY",
            agentRef: ref,
            agentName,
            resolution,
          });
          return { status: "ready", agentRef: ref, agentName, resolution };
        }

        // The agent declares keys. Keys already saved where the run reads
        // need nothing.
        const existingKeys = keysHeldBy(readVaults, servers);
        const savedOnlyMissing = diffEnv(envDeclarations, existingKeys);
        const missingVariables = diffEnv(envDeclarations, existingKeys, coveredKeys);

        if (savedOnlyMissing.length === 0) {
          const resolution: AgentResolution = { mode: "saved" };
          settle({
            type: "RESOLVE_READY",
            agentRef: ref,
            agentName,
            resolution,
          });
          return { status: "ready", agentRef: ref, agentName, resolution };
        }

        if (missingVariables.length === 0) {
          // Keys filled elsewhere (the platform's own) cover the rest.
          const resolution: AgentResolution = { mode: "direct" };
          settle({
            type: "RESOLVE_READY",
            agentRef: ref,
            agentName,
            resolution,
          });
          return { status: "ready", agentRef: ref, agentName, resolution };
        }

        // Missing variables — transition to needsEnvVars.
        settle({
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
        settle({ type: "ERROR", error: toError(err) });
        throw err;
      }
    },
    [org, orgId, stigmer, myVault.vault, poolKeys, choice],
  );

  // -------------------------------------------------------------------------
  // Vault re-evaluation — resolve again when the conversation's vault choice changes
  // -------------------------------------------------------------------------

  // Which vaults a run reads decides what counts as saved and which
  // sign-ins are owed, so an agent already resolved is resolved again over
  // the new pick. Keyed by content: only a change of vaults does this.
  const stateRef = useRef(state);
  stateRef.current = state;
  const resolvedVaultsKey = useRef(vaultsKey);
  useEffect(() => {
    if (resolvedVaultsKey.current === vaultsKey) return;
    resolvedVaultsKey.current = vaultsKey;
    const current = stateRef.current;
    if (current.status === "idle" || current.status === "submitting") return;
    resolveAgent(current.agentRef).catch(() => {
      // resolveAgent dispatched the error; the panel shows it.
    });
  }, [vaultsKey, resolveAgent]);

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
    // declares a variable My vault lacks.
    if (stillMissing.length === agentMissingVars.length) return;

    dispatch({ type: "POOL_RESOLVE", missingVariables: stillMissing });
  }, [poolKeys, agentMissingVars]);

  // -------------------------------------------------------------------------
  // submitEnvVars
  // -------------------------------------------------------------------------

  const submitEnvVars = useCallback(
    async (
      values: Record<string, EnvVarInput>,
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
      dispatch({ type: "SUBMIT_START" });

      try {
        await myVault.setSecrets(valuesOf(values));
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
    [org, myVault, state],
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
