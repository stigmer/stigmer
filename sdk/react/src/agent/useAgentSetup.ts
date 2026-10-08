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
 * whose `spec.auth.targetEnvVar` is set is satisfied by a connected grant;
 * a grant read that fails leaves it pending, fail-closed, so the row offers
 * Sign in rather than pretending; a server that cannot be read is the
 * resolution's error, thrown to the caller's catch.
 *
 * The grant read is My vault's alone, and reports only a sign-in made for
 * that very server. A conversation that lists vaults (`listedVaults` not
 * `null`) never reads My vault, so there a server is satisfied only when a
 * listed vault holds a login that serves it ({@link vaultLoginServes}), the
 * grant is not consulted, and a sign-in still owed is to be saved into the
 * first listed vault (`vault` on the pending sign-in), where the run will
 * look for it. One that lists none also counts every login in `ownVaults`
 * (My vault, then the agent's vaults the person may use) that serves the
 * server, as the run does: a login pasted at an HTTP tool's URL, which the
 * grant reports as no grant, and a sign-in kept in the agent's shared
 * vault, which the grant never sees. A grant whose token expired keeps the
 * server pending whatever else holds a login: the run meets that sign-in
 * in My vault first.
 */
async function readServers(
  stigmer: Stigmer,
  org: string,
  agent: Agent,
  listedVaults: readonly Vault[] | null,
  ownVaults: readonly Vault[],
): Promise<ServerReadings> {
  const servers: McpServer[] = [];
  const pendingSignIns: PendingSignIn[] = [];
  const signInVariables = new Set<string>();
  const firstListed = listedVaults?.[0];
  const signInVault =
    firstListed === undefined
      ? undefined
      : {
          id: firstListed.metadata?.id ?? "",
          org: firstListed.metadata?.org ?? org,
          name: firstListed.metadata?.name || firstListed.metadata?.slug || "",
        };
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
    let connected = false;
    if (listedVaults !== null) {
      connected = listedVaults.some((vault) => vaultLoginServes(vault.spec?.connections ?? {}, server));
    } else {
      try {
        const grant = await stigmer.mcpServer.getOAuthGrantStatus(
          create(GetOAuthGrantStatusInputSchema, { resourceId: id, org }),
        );
        health = grant.connectionHealth;
        connected = grant.connected;
      } catch {
        // Fail closed: an unreadable grant is a sign-in still owed.
      }
      connected =
        (connected || ownVaults.some((vault) => vaultLoginServes(vault.spec?.connections ?? {}, server))) &&
        health !== OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED;
    }
    if (connected) continue;
    pendingSignIns.push({
      ref: { org: ref.org || server.metadata?.org || org, slug: ref.slug || server.metadata?.slug || "" },
      id,
      name: server.metadata?.name || server.metadata?.slug || ref.slug,
      health,
      ...(signInVault === undefined ? {} : { vault: signInVault }),
    });
  }
  return { servers, pendingSignIns, signInVariables };
}

/**
 * The keys a run of `agent` would find for this person. A conversation that
 * lists vaults uses only those, so only what they hold counts. Without one:
 * My vault's, then the agent's shared vaults the person can see (a vault
 * they may not view is one their run may not use either). A vault fills a
 * key by a secret of its name, or, for a tool's login key, by a login that
 * serves that tool under the run's rule ({@link vaultLoginServes}). Names
 * and connection kinds only: no read returns a value.
 */
function savedKeysOf(
  ownVaults: readonly Vault[],
  listedVaults: readonly Vault[] | null,
  servers: readonly McpServer[],
): Set<string> {
  return keysHeldBy(listedVaults ?? ownVaults, servers);
}

/**
 * The vaults a run of `agent` reads for this person when the conversation
 * lists none: My vault, then the agent's vaults the person can see. Read
 * once per resolution, for its sign-ins and its keys alike.
 */
async function ownVaultsOf(stigmer: Stigmer, agent: Agent, myVault: Vault | null): Promise<Vault[]> {
  const agentOrg = agent.metadata?.org || "";
  const agentVaults = await readableVaults(
    stigmer,
    (agent.spec?.vaults ?? []).map((ref) => ({ org: ref.org || agentOrg, slug: ref.slug })),
  );
  return myVault === null ? agentVaults : [myVault, ...agentVaults];
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

/** Options for {@link UseAgentSetupReturn.submitEnvVars}. */
export interface SubmitEnvVarsOptions {
  /**
   * When `true` (default), the provided values are saved in the user's
   * My vault. Every conversation the user starts reads the keys an agent
   * declares from there, so later conversations reuse them without asking
   * again.
   *
   * When `false`, the values are kept for this conversation only, as its
   * own secrets — nothing is saved in a vault. This path is instant (no
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
   * Complete the env var collection flow for the pending agent.
   *
   * Behavior depends on `options.saveForFuture`:
   * - `true` (default) — Saves the provided values in My vault.
   *   Returns `{ resolution: { mode: "saved" } }`.
   * - `false` — Collects values for this conversation without any API calls.
   *   Returns `{ resolution: { mode: "oneTime", values } }`.
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
 * vault resolution, and secret delivery routing flow.
 *
 * When a user picks an agent in the {@link AgentPicker}, this hook
 * determines whether the agent requires credentials (via its
 * `env` declarations), checks what the user has already saved in their
 * vaults, and either reports the agent as ready or
 * identifies the missing variables so the caller can render
 * {@link AgentEnvForm}.
 *
 * The hook supports two secret delivery paths via the `saveForFuture`
 * option on {@link submitEnvVars}:
 * - **Saved** — secrets are saved in My vault, where every conversation
 *   the user starts reads the keys the agent declares.
 * - **One-time** — values are returned for this conversation only, as its
 *   own secrets, never saved in a vault.
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
 * @param poolKeys - Optional set of env-var keys already available
 *   from the session env pool (manual secrets, one-time env vars from
 *   other components). When provided, agents whose `env` keys
 *   are fully covered by `poolKeys` + My vault auto-resolve to
 *   `ready` without prompting. Reactive — when `poolKeys` changes,
 *   `needsEnvVars` is re-evaluated.
 * @param conversationVaults - The vaults the conversation lists, when it
 *   lists any. Such a conversation uses only those vaults, so only their
 *   keys and logins count as saved (not My vault's or the agent's vaults'),
 *   a sign-in counts only when one of them holds a login serving the server
 *   (never a My vault grant), each pending sign-in names the first listed
 *   vault as where to save it (`PendingSignIn.vault`), and values the
 *   person saves in My vault also reach the conversation as its own
 *   secrets (`oneTime`). `poolKeys` must then leave My vault's names out.
 *   Reactive — when the listed vaults change, an agent already resolved is
 *   resolved again over them, keeping the values the conversation holds.
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
  conversationVaults?: readonly ResourceRef[],
): UseAgentSetupReturn {
  const stigmer = useStigmer();
  const myVault = useMyVault(org);
  const orgId = useOrganizationId(org ?? "");
  // Keyed by content (org and slug, all a read uses): hosts pass a fresh
  // array per render, and the callbacks below must not churn with it.
  const vaultsKey = (conversationVaults ?? []).map((ref) => `${ref.org}/${ref.slug}`).join(",");
  const listedVaults = useMemo<readonly ResourceRef[]>(
    () => conversationVaults ?? [],
    [vaultsKey],
  );

  const [state, dispatch] = useReducer(agentSetupReducer, INITIAL_STATE);

  // The values this conversation already holds for the agent as its own
  // secrets (a `oneTime` resolution's). They serve whatever vaults the
  // conversation lists, so resolving the same agent again (a sign-in
  // landing, the vault pick changing) counts them and keeps them.
  const ownValuesRef = useRef<{ readonly agent: string; readonly values: Record<string, EnvVarInput> } | null>(null);

  // The latest resolution's number. An answer that lands after a newer
  // resolution started (the vault pick changed meanwhile) or after a reset
  // judged vaults that no longer apply, so it never reaches the state.
  const resolutionRef = useRef(0);

  const clearError = useCallback(() => dispatch({ type: "CLEAR_ERROR" }), []);
  const reset = useCallback(() => {
    resolutionRef.current += 1;
    ownValuesRef.current = null;
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

      const agentKey = `${ref.org}/${ref.slug}`;
      if (ownValuesRef.current?.agent !== agentKey) ownValuesRef.current = null;
      const ownValues = ownValuesRef.current?.values ?? {};
      const coveredKeys = new Set([...(poolKeys ?? []), ...Object.keys(ownValues)]);
      // Ready: the values the conversation holds for the agent ride on.
      const readyAs = (resolution: AgentResolution): AgentResolution =>
        Object.keys(ownValues).length > 0 ? { mode: "oneTime", values: ownValues } : resolution;

      try {
        const agent = await stigmer.agent.getByReference(ref);
        const agentName = agent.metadata?.name ?? ref.slug;

        // Sign-ins first: an agent whose OAuth server has no grant is not
        // ready however its variables stand. Nothing is created here; when
        // the last sign-in lands, `signInCompleted` resolves again and the
        // branches below run with the grant in place. The variables those
        // sign-ins fill leave the declarations here and are never typed.
        // A conversation that lists vaults reads only those, once, for its
        // logins and its secret names alike.
        const listed =
          listedVaults.length > 0
            ? await readableVaults(stigmer, listedVaults.map((v) => ({ org: v.org || org, slug: v.slug })))
            : null;
        // Without listed vaults, the run reads My vault and the agent's
        // vaults for its logins too, unless the agent is of another
        // organization, which reads neither.
        const ownVaults = listed === null ? await ownVaultsOf(stigmer, agent, myVault.vault) : [];
        const foreign = (agent.metadata?.org ?? "") !== orgId;
        const { servers, pendingSignIns, signInVariables } = await readServers(
          stigmer,
          org,
          agent,
          listed,
          foreign ? [] : ownVaults,
        );
        const envDeclarations = agent.spec?.env ? typedDeclarations(agent.spec.env, signInVariables) : undefined;
        if (pendingSignIns.length > 0) {
          const existingKeys = savedKeysOf(ownVaults, listed, servers);
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
        // reads none of the person's keys for it, so a key saved here
        // would never reach it.
        if (!envDeclarations || Object.keys(envDeclarations).length === 0 || foreign) {
          const resolution = readyAs({ mode: "direct" });
          settle({
            type: "RESOLVE_READY",
            agentRef: ref,
            agentName,
            resolution,
          });
          return { status: "ready", agentRef: ref, agentName, resolution };
        }

        // The agent declares keys. A run with no vaults of its own reads
        // them from the person's My vault, then the agent's vaults the
        // person may use; one that lists vaults reads only those. Keys
        // already saved where the run reads need nothing.
        const existingKeys = savedKeysOf(ownVaults, listed, servers);
        const savedOnlyMissing = diffEnv(envDeclarations, existingKeys);
        const missingVariables = diffEnv(envDeclarations, existingKeys, coveredKeys);

        if (savedOnlyMissing.length === 0) {
          const resolution = readyAs({ mode: "saved" });
          settle({
            type: "RESOLVE_READY",
            agentRef: ref,
            agentName,
            resolution,
          });
          return { status: "ready", agentRef: ref, agentName, resolution };
        }

        if (missingVariables.length === 0) {
          // The session's variables cover the remaining keys; their
          // values become the conversation's own secrets at submit.
          const resolution = readyAs({ mode: "direct" });
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
    [org, orgId, stigmer, myVault.vault, poolKeys, listedVaults],
  );

  // -------------------------------------------------------------------------
  // Vault re-evaluation — resolve again when the conversation's vaults change
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
      const agentKey = `${agentRef.org}/${agentRef.slug}`;
      const held = ownValuesRef.current?.agent === agentKey ? ownValuesRef.current.values : {};
      const ownValues = { ...held, ...values };
      const keepOwn = (): AgentResolution => {
        ownValuesRef.current = { agent: agentKey, values: ownValues };
        return { mode: "oneTime", values: ownValues };
      };

      // ----- One-time path: no API calls, instant result -----
      if (!saveForFuture) {
        const resolution = keepOwn();
        dispatch({
          type: "SUBMIT_READY",
          agentRef,
          agentName,
          resolution,
        });
        return { status: "ready", agentRef, agentName, resolution };
      }

      // ----- Save path: save in My vault -----
      dispatch({ type: "SUBMIT_START" });

      try {
        await myVault.setSecrets(valuesOf(values));

        // A conversation that lists vaults never reads My vault: the values
        // saved there for later conversations reach this one as its own,
        // beside those it already held.
        const resolution: AgentResolution =
          listedVaults.length > 0 || Object.keys(held).length > 0 ? keepOwn() : { mode: "saved" };
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
    [org, myVault, state, listedVaults],
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
