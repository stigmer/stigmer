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

/** Options for {@link UseMcpServerSetupReturn.submitEnvVars}. */
export interface SubmitMcpEnvVarsOptions {
  /**
   * When `true` (default), the provided values are saved to the user's
   * My vault. Subsequent sessions using the same MCP server
   * will reuse these credentials. A conversation that lists vaults never
   * reads My vault, so there the values also become its own secrets
   * (`pendingOneTimeValues`).
   *
   * When `false`, the values are collected as `pendingOneTimeValues` for
   * this conversation only — nothing is saved in a vault and no network
   * calls are made here. They become the conversation's own secrets.
   *
   * @default true
   */
  readonly saveForFuture?: boolean;
}

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
   * My vault (or, when the conversation lists vaults, only those vaults),
   * and resolves the entry to either `ready`
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
   * Complete credential collection for a server in `needsSetup` status.
   *
   * Behavior depends on `options.saveForFuture`:
   * - `true` (default) — Saves values to the My vault via
   *   `setSecrets` / `setConnection`. The server transitions to `ready`.
   * - `false` — Accumulates values into {@link pendingOneTimeValues}
   *   without API calls. The server transitions to `ready` immediately.
   *
   * Must only be called when the entry is in `needsSetup` status.
   */
  readonly submitEnvVars: (
    ref: ResourceRef,
    values: Record<string, EnvVarInput>,
    options?: SubmitMcpEnvVarsOptions,
  ) => Promise<void>;

  /** Clear the error on a specific server entry without changing its phase. */
  readonly clearError: (ref: ResourceRef) => void;

  /** Reset all entries and pending one-time values to initial state. */
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
   * Accumulated one-time env vars from servers whose credentials were
   * submitted with `saveForFuture: false`.
   *
   * Consumed imperatively at session creation time and merged into
   * the conversation's own secrets. Cleared on {@link reset}.
   */
  readonly pendingOneTimeValues: Record<string, EnvVarInput>;

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
 * full resource, checks its `env` declarations against My vault
 * (via {@link diffEnv}), and determines whether credentials are
 * needed. It also extracts the server's discovered tools for display.
 *
 * The hook supports two credential delivery paths via the `saveForFuture`
 * option on {@link submitEnvVars}:
 * - **Saved** — secrets are saved in My vault for
 *   reuse across sessions.
 * - **One-time** — secrets are collected as `pendingOneTimeValues` for a
 *   single conversation, never saved in a vault.
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
 * @param poolKeys - Optional set of env-var keys already available
 *   from the session env pool (manual secrets, one-time env vars from
 *   other components). When provided, servers whose `env` keys
 *   are fully covered by `poolKeys` + My vault auto-resolve to
 *   `ready` without prompting. Reactive — when `poolKeys` changes,
 *   `needsSetup` entries are re-evaluated.
 * @param conversationVaults - The vaults the conversation lists, when it
 *   lists any. Such a conversation uses only those vaults, so only their
 *   keys and logins count as saved (not My vault's), and values the person
 *   saves in My vault also reach the conversation as its own secrets
 *   (`pendingOneTimeValues`). `poolKeys` must then leave My vault's names
 *   out. A sign-in counts only when a listed vault holds it (a sign-in
 *   from the picker there is saved into the first listed vault), never My
 *   vault's grant, which such a run never reads. Reactive — when the listed
 *   vaults change, every server already added is evaluated again over
 *   them; values kept as the conversation's own still count.
 *
 * @example
 * ```tsx
 * const {
 *   entries,
 *   addServer,
 *   submitEnvVars,
 *   allReady,
 *   usageInputs,
 * } = useMcpServerSetup("acme", pool.availableKeys);
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
  conversationVaults?: readonly ResourceRef[],
): UseMcpServerSetupReturn {
  const stigmer = useStigmer();
  const myVault = useMyVault(org);
  // Keyed by content (org and slug, all a read uses): hosts pass a fresh
  // array per render, and the callbacks below must not churn with it.
  const vaultsKey = (conversationVaults ?? []).map((ref) => `${ref.org}/${ref.slug}`).join(",");
  const listedVaults = useMemo<readonly ResourceRef[]>(
    () => conversationVaults ?? [],
    [vaultsKey],
  );

  const [entries, dispatch] = useReducer(
    mcpServerSetupReducer,
    INITIAL_MCP_SETUP_STATE,
  );

  const oneTimeValuesRef = useRef<Record<string, EnvVarInput>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

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

        // A conversation that lists vaults reads only those; one that
        // lists none reads My vault.
        const existingKeys =
          listedVaults.length > 0
            ? await listedVaultKeysFor(stigmer, mcpServer, listedVaults, org)
            : savedKeysFor(mcpServer, myVault.vault);

        // Carried onto the entry so consumers can tell a healthy grant
        // that merely lacks tool discovery (offer bare discovery,
        // stigmer/stigmer#418) apart from an expired one (offer re-auth).
        let oauthConnectionHealth: OAuthConnectionHealth | undefined;

        // The grant read is My vault's alone, so it credits only a
        // conversation that reads My vault. One that lists vaults counts a
        // login only where a listed vault holds one serving this server,
        // which listedVaultKeysFor has already weighed.
        const auth = mcpServer.spec?.auth;
        if (auth?.targetEnvVar && mcpServer.metadata?.id && listedVaults.length === 0) {
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

        // Values already kept as the conversation's own serve whatever
        // vaults it lists.
        const coveredKeys = new Set([...(poolKeys ?? []), ...Object.keys(oneTimeValuesRef.current)]);
        const allMissing = diffEnv(envDeclarations, existingKeys, coveredKeys);
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
    [org, stigmer, myVault.vault, poolKeys, listedVaults],
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
      options?: SubmitMcpEnvVarsOptions,
    ): Promise<void> => {
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

      const saveForFuture = options?.saveForFuture ?? true;

      dispatch({ type: "SUBMIT_START", key });

      if (!saveForFuture) {
        Object.assign(oneTimeValuesRef.current, values);
        dispatch({ type: "SUBMIT_DONE", key });
        return;
      }

      try {
        await saveToMyVault(myVault, values, entry.mcpServer);
        // A conversation that lists vaults never reads My vault: the values
        // saved there for later conversations reach this one as its own.
        if (listedVaults.length > 0) Object.assign(oneTimeValuesRef.current, values);
        dispatch({ type: "SUBMIT_DONE", key });
      } catch (err) {
        dispatch({ type: "SUBMIT_FAIL", key, error: toError(err) });
      }
    },
    [org, entries, myVault, listedVaults],
  );

  // -------------------------------------------------------------------------
  // clearError / reset
  // -------------------------------------------------------------------------

  const clearError = useCallback((ref: ResourceRef): void => {
    dispatch({ type: "CLEAR_ERROR", key: toServerKey(ref) });
  }, []);

  const reset = useCallback((): void => {
    dispatch({ type: "RESET" });
    oneTimeValuesRef.current = {};
  }, []);

  // -------------------------------------------------------------------------
  // Pool re-evaluation — auto-resolve needsSetup entries when pool changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!poolKeys || poolKeys.size === 0) return;

    for (const [key, entry] of Object.entries(entriesRef.current)) {
      if (entry.status !== "needsSetup") continue;

      const envDeclarations = entry.mcpServer.spec?.env;
      if (!envDeclarations) continue;

      // The listed vaults were read when the server was added; since then
      // only the pool can cover more of what it still lacks.
      if (listedVaults.length > 0) {
        const stillMissing = entry.missingVariables.filter((v) => !poolKeys.has(v.key));
        if (stillMissing.length === entry.missingVariables.length) continue;
        dispatch({ type: "POOL_RESOLVE", key, missingVariables: stillMissing });
        continue;
      }

      const allMissing = diffEnv(
        envDeclarations,
        savedKeysFor(entry.mcpServer, myVault.vault),
        poolKeys,
      );
      const requiredMissing = allMissing.filter((v) => !v.optional);
      dispatch({ type: "POOL_RESOLVE", key, missingVariables: requiredMissing });
    }
  }, [poolKeys, myVault.vault, listedVaults]);

  // -------------------------------------------------------------------------
  // Vault re-evaluation — evaluate every server again when the vaults change
  // -------------------------------------------------------------------------

  // Which vaults a run reads decides what counts as saved, so each server
  // already added is evaluated again over the new pick. Keyed by content:
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
    pendingOneTimeValues: oneTimeValuesRef.current,
    usageInputs,
  };
}

/**
 * The variables the vaults a conversation lists fill for a server: their
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
