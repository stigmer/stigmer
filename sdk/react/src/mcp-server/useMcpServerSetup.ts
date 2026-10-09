"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { McpServerUsageInput, ResourceRef, Stigmer } from "@stigmer/sdk";
import type { EnvVarInput } from "../vault/types.js";
import { create } from "@bufbuild/protobuf";
import { GetOAuthGrantStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useStigmer } from "../hooks.js";
import { useMyVault } from "../vault/useMyVault.js";
import { toolLoginKeyOf, vaultLoginServes } from "../vault/address.js";
import { MY_VAULT_ONLY, conversationVaultsKey, type ConversationVaults } from "../vault/conversationVaults.js";
import { saveToMyVault, savedKeysFor } from "./useMcpServerCredentials.js";
import { diffEnv } from "../vault/diffEnv.js";
import { toError } from "../internal/toError.js";
import {
  mcpServerSetupReducer,
  INITIAL_MCP_SETUP_STATE,
  toServerKey,
} from "./mcpServerSetupReducer.js";

// ---------------------------------------------------------------------------
// Public types (re-exported from mcpServerSetupReducer for convenience)
// ---------------------------------------------------------------------------

export type {
  McpServerSetupEntry,
  McpServerSetupPhase,
  McpServerSetupState,
} from "./mcpServerSetupReducer.js";

export { toServerKey } from "./mcpServerSetupReducer.js";

/** Return value of {@link useMcpServerSetup}. */
export interface UseMcpServerSetupReturn {
  /**
   * Per-server setup state, keyed by `"org/slug"` (see {@link toServerKey}).
   *
   * Each entry tracks an individual MCP server through the setup
   * lifecycle: `loading → needsSetup → submitting → ready` (or
   * `loading → ready` when no credentials are required).
   */
  readonly entries: Readonly<Record<string, import("./mcpServerSetupReducer").McpServerSetupEntry>>;

  /**
   * Add an MCP server to the setup flow.
   *
   * Fetches the full server resource, checks `env` declarations against
   * the vaults the conversation uses (My vault when included, then the
   * listed vaults), and resolves the entry to either `ready`
   * (no credentials needed or all present) or `needsSetup` (missing
   * variables). Also extracts the server's discovered tools.
   *
   * If the server is already in entries, its entry is reset to
   * `loading` and re-evaluated.
   */
  readonly addServer: (ref: ResourceRef) => Promise<void>;

  /**
   * Remove an MCP server from the setup flow.
   *
   * Removes the entry from state. Safe to call for servers not in
   * entries (no-op).
   */
  readonly removeServer: (ref: ResourceRef) => void;

  /**
   * Complete credential collection for a server in `needsSetup` status:
   * the values are saved in My vault (`setSecrets` / `setConnection`), the
   * one place a value the person types goes, and the server transitions
   * to `ready`. A conversation reads them when it includes My vault; the
   * composer includes it for the person who may change the conversation's
   * vaults; a conversation that leaves My vault out keeps the server in
   * `needsSetup` until it includes My vault. Resolves `true` once the
   * values are saved, `false` when the save failed (the entry carries the
   * error).
   *
   * Must only be called when the entry is in `needsSetup` status.
   */
  readonly submitEnvVars: (
    ref: ResourceRef,
    values: Record<string, EnvVarInput>,
  ) => Promise<boolean>;

  /** Clear the error on a specific server entry without changing its phase. */
  readonly clearError: (ref: ResourceRef) => void;

  /** Reset all entries to the initial state. */
  readonly reset: () => void;

  /**
   * `true` when every selected server is in `ready` status, or when
   * no servers are selected. `false` during `loading`, `needsSetup`,
   * or `submitting` for any entry.
   *
   * Use this for submission blocking in the session composer.
   */
  readonly allReady: boolean;

  /**
   * Count of entries in `needsSetup` status — servers that require
   * user-provided credentials before the session can be created.
   */
  readonly needsSetupCount: number;

  /**
   * Ready servers as `McpServerUsageInput[]` for session creation.
   *
   * Derived from entries: only `ready` entries are included. Each usage
   * attaches the whole server; the agent's tool lists narrow it.
   */
  readonly usageInputs: McpServerUsageInput[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Layer 2 behavior hook that orchestrates the setup flow for multiple
 * MCP servers selected in the {@link McpServerPicker}.
 *
 * When a user toggles an MCP server ON, this hook fetches the server's
 * full resource, checks its `env` declarations against the vaults the
 * conversation uses (via {@link diffEnv}), and determines whether
 * credentials are needed. It also extracts the server's discovered tools
 * for display. A value the person types is saved in My vault
 * ({@link submitEnvVars}); a conversation never carries values of its own.
 *
 * State is managed by `useReducer(mcpServerSetupReducer)` — a per-server
 * state machine with four phases:
 * `loading → needsSetup → submitting → ready`.
 *
 * Composes {@link useMyVault} for credential persistence and
 * the Stigmer client for MCP server queries.
 *
 * Mirrors the architecture of {@link useAgentSetup} but adapted for
 * multi-server orchestration (N independent entries vs. single agent).
 *
 * Pass `null` as `org` to disable all operations (stable no-op).
 *
 * @param org - Organization id (a slug is also accepted). Pass `null` to disable.
 * @param poolKeys - Optional set of env-var keys filled elsewhere (the
 *   platform's own keys, which the runner sets). Servers whose `env` keys
 *   are fully covered by `poolKeys` and the vaults the run reads
 *   auto-resolve to `ready` without prompting. Reactive — when `poolKeys`
 *   changes, `needsSetup` entries are re-evaluated.
 * @param conversationVaults - The vaults the conversation uses (its
 *   sender's My vault when included, then the listed vaults). Only what
 *   they hold counts as saved, and My vault's sign-in grant counts only
 *   when My vault is included. Omitted, the run is taken to read My vault
 *   alone. Reactive — when the choice changes, every server already added
 *   is evaluated again over it.
 *
 * @example
 * ```tsx
 * const {
 *   entries,
 *   addServer,
 *   submitEnvVars,
 *   allReady,
 *   usageInputs,
 * } = useMcpServerSetup("acme");
 *
 * // When user toggles a server ON in the picker:
 * await addServer({ org: "acme", slug: "github", kind: ApiResourceKind.mcp_server });
 *
 * // If the entry resolves to "needsSetup":
 * await submitEnvVars(ref, { GITHUB_TOKEN: { value: "ghp_...", isSecret: true } });
 *
 * // At session creation:
 * const session = await createSession({ mcpServerUsages: usageInputs });
 * ```
 */
export function useMcpServerSetup(
  org: string | null,
  poolKeys?: Set<string>,
  conversationVaults: ConversationVaults = MY_VAULT_ONLY,
): UseMcpServerSetupReturn {
  const stigmer = useStigmer();
  const myVault = useMyVault(org);
  // Keyed by content: hosts pass a fresh choice per render, and the
  // callbacks below must not churn with it.
  const vaultsKey = conversationVaultsKey(conversationVaults);
  const choice = useMemo<ConversationVaults>(() => conversationVaults, [vaultsKey]);

  const [entries, dispatch] = useReducer(
    mcpServerSetupReducer,
    INITIAL_MCP_SETUP_STATE,
  );

  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  // My vault as last read. An evaluation weighs it when it settles, so one
  // still in flight when a reload lands (the one a save starts) counts the
  // reload's answer.
  const myVaultRef = useRef(myVault.vault);
  myVaultRef.current = myVault.vault;
  // The choice as it stands when a save lands, which the person may have
  // changed while it was in flight.
  const choiceRef = useRef(choice);
  choiceRef.current = choice;

  // Each server's latest evaluation, by number. An answer that lands after
  // a newer evaluation of the same server started (the vault pick changed
  // meanwhile) judged vaults that no longer apply, so it never reaches the
  // state, where it would also leave the newer answer nothing to settle.
  const evaluationsRef = useRef(0);
  const latestEvaluationRef = useRef(new Map<string, number>());

  // -------------------------------------------------------------------------
  // addServer
  // -------------------------------------------------------------------------

  const addServer = useCallback(
    async (ref: ResourceRef): Promise<void> => {
      if (!org) {
        throw new Error(
          "useMcpServerSetup: cannot add server when org is null.",
        );
      }

      const key = toServerKey(ref);
      dispatch({ type: "ADD_SERVER", key });
      const turn = ++evaluationsRef.current;
      latestEvaluationRef.current.set(key, turn);
      const settle: typeof dispatch = (action) => {
        if (latestEvaluationRef.current.get(key) === turn) dispatch(action);
      };

      try {
        const mcpServer = await stigmer.mcpServer.getByReference(ref);

        const discoveredTools =
          mcpServer.status?.discoveredCapabilities?.tools ?? [];
        const envDeclarations = mcpServer.spec?.env;

        if (!envDeclarations || Object.keys(envDeclarations).length === 0) {
          settle({
            type: "RESOLVE_READY",
            key,
            mcpServer,
            discoveredTools,
          });
          return;
        }

        // The run reads exactly the vaults the conversation uses: My vault
        // when included (weighed below, as it stands when this settles),
        // then the listed vaults.
        const existingKeys = await listedVaultKeysFor(stigmer, mcpServer, choice.vaults, org);

        // Carried onto the entry so consumers can tell a healthy grant
        // that merely lacks tool discovery (offer bare discovery,
        // stigmer/stigmer#418) apart from an expired one (offer re-auth).
        let oauthConnectionHealth: OAuthConnectionHealth | undefined;

        // The grant read is My vault's alone, so it credits only a
        // conversation that includes My vault. A login a listed vault holds
        // serving this server is already weighed by listedVaultKeysFor.
        const auth = mcpServer.spec?.auth;
        if (auth?.targetEnvVar && mcpServer.metadata?.id && choice.includeMyVault) {
          try {
            const grantStatus = await stigmer.mcpServer.getOAuthGrantStatus(
              create(GetOAuthGrantStatusInputSchema, {
                resourceId: mcpServer.metadata.id,
                org,
              }),
            );
            oauthConnectionHealth = grantStatus.connectionHealth;
            if (grantStatus.connected) {
              existingKeys.add(auth.targetEnvVar);
            }
          } catch {
            // Non-fatal: if grant status lookup fails, the OAuth var stays
            // in missingVariables and the UI shows the sign-in button.
          }
        }

        if (choice.includeMyVault) {
          for (const key of savedKeysFor(mcpServer, myVaultRef.current)) existingKeys.add(key);
        }
        const allMissing = diffEnv(envDeclarations, existingKeys, poolKeys);
        const requiredMissing = allMissing.filter((v) => !v.optional);

        if (requiredMissing.length === 0) {
          settle({
            type: "RESOLVE_READY",
            key,
            mcpServer,
            discoveredTools,
            oauthConnectionHealth,
          });
          return;
        }

        settle({
          type: "RESOLVE_NEEDS_SETUP",
          key,
          mcpServer,
          missingVariables: requiredMissing,
          discoveredTools,
          oauthConnectionHealth,
        });
      } catch (err) {
        settle({ type: "SET_ERROR", key, error: toError(err) });
      }
    },
    [org, stigmer, poolKeys, choice],
  );

  // -------------------------------------------------------------------------
  // removeServer
  // -------------------------------------------------------------------------

  const removeServer = useCallback((ref: ResourceRef): void => {
    dispatch({ type: "REMOVE_SERVER", key: toServerKey(ref) });
  }, []);

  // -------------------------------------------------------------------------
  // submitEnvVars
  // -------------------------------------------------------------------------

  const submitEnvVars = useCallback(
    async (
      ref: ResourceRef,
      values: Record<string, EnvVarInput>,
    ): Promise<boolean> => {
      if (!org) {
        throw new Error(
          "useMcpServerSetup: cannot submit env vars when org is null.",
        );
      }

      const key = toServerKey(ref);
      const entry = entries[key];

      if (!entry || entry.status !== "needsSetup") {
        throw new Error(
          "useMcpServerSetup: submitEnvVars requires the server to be in " +
            `'needsSetup' status. Server '${key}' is ` +
            `${entry ? `in '${entry.status}' status` : "not selected"}. ` +
            "Call addServer() first and wait for it to resolve.",
        );
      }

      dispatch({ type: "SUBMIT_START", key });

      try {
        await saveToMyVault(myVault, values, entry.mcpServer);
      } catch (err) {
        dispatch({ type: "SUBMIT_FAIL", key, error: toError(err) });
        return false;
      }
      // The values filled what the server lacked, but only a conversation
      // that reads My vault reads them there.
      dispatch(choiceRef.current.includeMyVault ? { type: "SUBMIT_DONE", key } : { type: "SUBMIT_UNREAD", key });
      return true;
    },
    [org, entries, myVault],
  );

  // -------------------------------------------------------------------------
  // clearError / reset
  // -------------------------------------------------------------------------

  const clearError = useCallback((ref: ResourceRef): void => {
    dispatch({ type: "CLEAR_ERROR", key: toServerKey(ref) });
  }, []);

  const reset = useCallback((): void => {
    dispatch({ type: "RESET" });
  }, []);

  // -------------------------------------------------------------------------
  // Pool re-evaluation — auto-resolve needsSetup entries when the pool or
  // My vault covers more
  // -------------------------------------------------------------------------

  // The listed vaults were read when the server was added; since then only
  // the pool, and My vault when the conversation includes it, can cover
  // more of what a server still lacks.
  useEffect(() => {
    for (const [key, entry] of Object.entries(entriesRef.current)) {
      if (entry.status !== "needsSetup") continue;
      const myVaultKeys = choice.includeMyVault ? savedKeysFor(entry.mcpServer, myVault.vault) : new Set<string>();
      const stillMissing = entry.missingVariables.filter(
        (v) => !(poolKeys?.has(v.key) ?? false) && !myVaultKeys.has(v.key),
      );
      if (stillMissing.length === entry.missingVariables.length) continue;
      dispatch({ type: "POOL_RESOLVE", key, missingVariables: stillMissing });
    }
  }, [poolKeys, myVault.vault, choice]);

  // -------------------------------------------------------------------------
  // Vault re-evaluation — evaluate every server again when the vaults change
  // -------------------------------------------------------------------------

  // Which vaults a run reads decides what counts as saved, so each server
  // already added is evaluated again over the new choice. Keyed by content:
  // only a change of vaults does this. A server mid-submit is left to land.
  const evaluatedVaultsKey = useRef(vaultsKey);
  useEffect(() => {
    if (evaluatedVaultsKey.current === vaultsKey) return;
    evaluatedVaultsKey.current = vaultsKey;
    for (const [key, entry] of Object.entries(entriesRef.current)) {
      if (entry.status === "submitting") continue;
      const separatorIdx = key.indexOf("/");
      void addServer({
        org: key.slice(0, separatorIdx),
        slug: key.slice(separatorIdx + 1),
        kind: ApiResourceKind.mcp_server,
      });
    }
  }, [vaultsKey, addServer]);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const allReady = useMemo(() => {
    const values = Object.values(entries);
    return values.length === 0 || values.every(e => e.status === "ready");
  }, [entries]);

  const needsSetupCount = useMemo(
    () =>
      Object.values(entries).filter(e => e.status === "needsSetup").length,
    [entries],
  );

  const usageInputs = useMemo(() => {
    const result: McpServerUsageInput[] = [];

    for (const [serverKey, entry] of Object.entries(entries)) {
      if (entry.status !== "ready") continue;

      const separatorIdx = serverKey.indexOf("/");
      result.push({
        mcpServerRef: {
          org: serverKey.slice(0, separatorIdx),
          slug: serverKey.slice(separatorIdx + 1),
          kind: ApiResourceKind.mcp_server,
        },
      });
    }

    return result;
  }, [entries]);

  return {
    entries,
    addServer,
    removeServer,
    submitEnvVars,
    clearError,
    reset,
    allReady,
    needsSetupCount,
    usageInputs,
  };
}

/**
 * The variables the shared vaults a conversation lists fill for a server: their
 * secrets by name, plus the server's login variable when one of them holds
 * a connection that serves this server ({@link vaultLoginServes}: a sign-in
 * started from it, or a pasted login at an HTTP server's own URL). A vault
 * this person cannot read is one their run cannot use, so it fills nothing.
 * Names and connection kinds only: no read returns a value.
 */
async function listedVaultKeysFor(
  stigmer: Stigmer,
  mcpServer: McpServer,
  refs: readonly ResourceRef[],
  org: string,
): Promise<Set<string>> {
  const keys = new Set<string>();
  let loginSaved = false;
  for (const ref of refs) {
    try {
      const vault = await stigmer.vault.getByReference({ org: ref.org || org, slug: ref.slug });
      for (const name of Object.keys(vault.spec?.secrets ?? {})) keys.add(name);
      if (vaultLoginServes(vault.spec?.connections ?? {}, mcpServer)) loginSaved = true;
    } catch {
      // A vault this person cannot read is one their run cannot use.
    }
  }
  const loginKey = toolLoginKeyOf(mcpServer);
  if (loginKey && loginSaved) keys.add(loginKey);
  return keys;
}
