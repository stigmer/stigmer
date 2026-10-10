"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { create } from "@bufbuild/protobuf";
import type { ResourceRef, Stigmer } from "@stigmer/sdk";
import { GetMyVaultInputSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import type { EnvVarInput } from "../vault/types.js";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useMyVault } from "../vault/useMyVault.js";
import { valuesOf } from "../vault/types.js";
import { toolLoginKeyOf, vaultLoginServes } from "../vault/address.js";
import { MY_VAULT_ONLY, conversationVaultsKey, type ConversationVaults } from "../vault/conversationVaults.js";
import { pluginDeclarations, readPlugins, serversOf, signInKeys, signInServers } from "../plugin/pluginRequirements.js";
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

/** What the agent's plugins say about its readiness. */
interface PluginReadings {
  /** Every MCP server of the plugins the agent lists. */
  readonly servers: McpServerEntry[];
  /** The servers that sign in and have no login where the run reads, one per address. */
  readonly pendingSignIns: PendingSignIn[];
  /** The keys the plugins' servers and hooks read, with their declarations. */
  readonly declarations: Record<string, EnvVarDeclaration>;
  /**
   * The login key of every server that signs in, signed in or not: the
   * variables a sign-in fills and the composer never asks for.
   */
  readonly signInVariables: ReadonlySet<string>;
}

/**
 * Reads the plugins the agent lists once, and judges their servers that
 * sign in: such a server is satisfied by a login at its address in a vault
 * the run reads ({@link vaultLoginServes}, the run's own rule: a sign-in
 * and a pasted login alike, whichever page saved it). A plugin that cannot
 * be read is the resolution's error, thrown to the caller's catch.
 *
 * `readVaults` are the vaults the run reads, as the person can see them
 * (My vault first when the conversation includes it, then the listed
 * vaults). Every sign-in still owed is saved in My vault.
 */
async function readAgentPlugins(
  stigmer: Stigmer,
  agent: Agent,
  readVaults: readonly Vault[],
): Promise<PluginReadings> {
  const read = await readPlugins(stigmer, agent.spec?.plugins ?? [], agent.metadata?.org ?? "");
  const plugins = read.map((entry) => entry.plugin);
  const pendingSignIns = signInServers(read)
    .filter(({ server }) => !readVaults.some((vault) => vaultLoginServes(vault.spec?.connections ?? {}, server)))
    .map(({ plugin, pluginName, server, address }) => ({
      plugin,
      pluginName,
      server,
      address,
      name: pluginName === server.name ? pluginName : `${pluginName} · ${server.name}`,
    }));
  return {
    servers: serversOf(plugins),
    pendingSignIns,
    declarations: pluginDeclarations(plugins),
    signInVariables: signInKeys(plugins),
  };
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
function keysHeldBy(vaults: readonly Vault[], servers: readonly McpServerEntry[]): Set<string> {
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
 * The declarations the composer may ask the user to type: the agent's own
 * and those of the plugins it lists.
 *
 * The login key of a server that signs in is filled by a sign-in: a run
 * fills it from the login saved at the server's address, never from a
 * value typed here. Without a login it is a Sign in row; with one it is
 * satisfied. Either way it is not a form field, and an agent whose only
 * declarations are such variables is as ready as one that declares nothing.
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
   * and the agent is resolved again over the conversation's vault choice,
   * counting what the save wrote. A conversation that includes My vault
   * resolves `ready` (`{ mode: "saved" }`); one that leaves it out stays
   * in `needsEnvVars` until it includes My vault, which the composer does
   * for the person who may change the conversation's vaults.
   *
   * Must only be called when `state.status === "needsEnvVars"`.
   */
  readonly submitEnvVars: (
    values: Record<string, EnvVarInput>,
  ) => Promise<AgentSetupResult>;

  /**
   * Record that one of the pending sign-ins completed (the row's own
   * sign-in landed), by the address it saved its login at. When it was
   * the last one, the agent is resolved again through {@link resolveAgent},
   * which now finds the login and lands in `ready` or in `needsEnvVars`
   * for its variables alone.
   *
   * Must only be called when `state.status === "needsEnvVars"`.
   */
  readonly signInCompleted: (address: string) => Promise<void>;

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
 * the plugins it lists.
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
 *   they hold counts as saved, and a login in My vault counts only when
 *   My vault is included. Omitted, the run is taken to read My vault
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

  // My vault as last known: the read's answer, or, right after a save here,
  // the vault the write returned, which is newer than the read until the
  // reload the write starts lands. A resolution reads it when it runs, so
  // one started between the save and that reload counts what was saved.
  const latestMyVaultRef = useRef<{ readonly read: Vault | null; readonly current: Vault | null }>({
    read: myVault.vault,
    current: myVault.vault,
  });
  if (latestMyVaultRef.current.read !== myVault.vault) {
    latestMyVaultRef.current = { read: myVault.vault, current: myVault.vault };
  }

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

        // Sign-ins first: an agent whose plugin server that signs in has no
        // login is not ready however its variables stand. Nothing is
        // created here; when the last sign-in lands, `signInCompleted`
        // resolves again and the branches below run with the login in place. The variables those
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
        const mine = latestMyVaultRef.current.current;
        const readVaults = readsMyVault && mine !== null ? [mine, ...listed] : listed;
        const { servers, pendingSignIns, declarations, signInVariables } = await readAgentPlugins(stigmer, agent, readVaults);
        const declared = { ...declarations, ...(agent.spec?.env ?? {}) };
        const envDeclarations = Object.keys(declared).length > 0 ? typedDeclarations(declared, signInVariables) : undefined;
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
    [org, orgId, stigmer, poolKeys, choice],
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
  // My vault re-evaluation — resolve again when My vault's read lands
  // -------------------------------------------------------------------------

  // A conversation that includes My vault counts what it holds, so an agent
  // judged before My vault's read landed (its first load, or the reload a
  // save starts) is judged again over what it holds now. A newer
  // resolution overtakes one still in flight. Nothing is re-judged while a
  // save is under way: the save resolves again itself.
  const judgedMyVault = useRef(myVault.vault);
  useEffect(() => {
    if (judgedMyVault.current === myVault.vault) return;
    judgedMyVault.current = myVault.vault;
    if (!choice.includeMyVault) return;
    const current = stateRef.current;
    if (current.status === "idle" || current.status === "submitting") return;
    resolveAgent(current.agentRef).catch(() => {
      // resolveAgent dispatched the error; the panel shows it.
    });
  }, [myVault.vault, choice.includeMyVault, resolveAgent]);

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
    ): Promise<AgentSetupResult> => {
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
            "Call signInCompleted(address) as each lands; the agent is resolved again when the last one does.",
        );
      }

      const { agentRef } = state;
      dispatch({ type: "SUBMIT_START" });

      let saved: Vault;
      try {
        saved = await myVault.setSecrets(valuesOf(values));
      } catch (err) {
        dispatch({ type: "ERROR", error: toError(err) });
        throw err;
      }
      // Judged again over the conversation's own choice, counting what the
      // save wrote before the reload it starts lands: a conversation that
      // leaves My vault out is not ready because a key landed there.
      latestMyVaultRef.current = { read: latestMyVaultRef.current.read, current: saved };
      return resolveAgent(agentRef);
    },
    [org, myVault, state, resolveAgent],
  );

  // The sign-in was saved into My vault by the row's own hook, so this
  // hook's read of My vault predates it: My vault is read again before the
  // agent is, and the reload is started for every other reader.
  const refetchMyVault = myVault.refetch;
  const refreshMyVault = useCallback(async (): Promise<void> => {
    if (!org) return;
    try {
      const fresh = await stigmer.vault.getMine(create(GetMyVaultInputSchema, { org }));
      latestMyVaultRef.current = { read: latestMyVaultRef.current.read, current: fresh };
    } catch {
      // Unreadable now: the resolution judges what was read before.
    }
    refetchMyVault();
  }, [org, stigmer, refetchMyVault]);

  const signInCompleted = useCallback(
    async (address: string): Promise<void> => {
      if (state.status !== "needsEnvVars") return;
      const remaining = state.pendingSignIns.filter((signIn) => signIn.address !== address);
      if (remaining.length === state.pendingSignIns.length) return;
      dispatch({ type: "SIGN_IN_COMPLETED", address });
      if (remaining.length === 0) {
        await refreshMyVault();
        try {
          await resolveAgent(state.agentRef);
        } catch {
          // resolveAgent dispatched the error; the panel shows it.
        }
      }
    },
    [state, resolveAgent, refreshMyVault],
  );

  return { state, resolveAgent, submitEnvVars, signInCompleted, clearError, reset };
}
