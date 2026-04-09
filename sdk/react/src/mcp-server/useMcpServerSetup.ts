"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { EnvVarInput, McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { DiscoveredTool } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useStigmer } from "../hooks";
import { usePersonalEnvironment } from "../environment/usePersonalEnvironment";
import { diffEnvSpec } from "../environment/diffEnvSpec";
import { toError } from "../internal/toError";
import {
  mcpServerSetupReducer,
  INITIAL_MCP_SETUP_STATE,
  toServerKey,
} from "./mcpServerSetupReducer";

// ---------------------------------------------------------------------------
// Public types (re-exported from mcpServerSetupReducer for convenience)
// ---------------------------------------------------------------------------

export type {
  McpServerSetupEntry,
  McpServerSetupPhase,
  McpServerSetupState,
} from "./mcpServerSetupReducer";

export { toServerKey } from "./mcpServerSetupReducer";

/** Options for {@link UseMcpServerSetupReturn.submitEnvVars}. */
export interface SubmitMcpEnvVarsOptions {
  /**
   * When `true` (default), the provided values are saved to the user's
   * personal environment. Subsequent sessions using the same MCP server
   * will reuse these credentials.
   *
   * When `false`, the values are collected as `pendingRuntimeEnv` for
   * this session only — no data is persisted and no network calls are
   * made. The runtime env is passed to execution creation.
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
   * Fetches the full server resource, checks `env_spec` against the
   * personal environment, and resolves the entry to either `ready`
   * (no credentials needed or all present) or `needsSetup` (missing
   * variables). Also extracts discovered tools and approval policies
   * for the tool selector.
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
   * - `true` (default) — Saves values to the personal environment via
   *   `addVariables`. The server transitions to `ready`.
   * - `false` — Accumulates values into {@link pendingRuntimeEnv}
   *   without API calls. The server transitions to `ready` immediately.
   *
   * Must only be called when the entry is in `needsSetup` status.
   */
  readonly submitEnvVars: (
    ref: ResourceRef,
    values: Record<string, EnvVarInput>,
    options?: SubmitMcpEnvVarsOptions,
  ) => Promise<void>;

  /**
   * Update the enabled tools for a server in `ready` status.
   *
   * Dispatches directly to the reducer. Safe to call frequently
   * (e.g., from tool selector checkboxes).
   */
  readonly setEnabledTools: (ref: ResourceRef, tools: string[]) => void;

  /** Clear the error on a specific server entry without changing its phase. */
  readonly clearError: (ref: ResourceRef) => void;

  /** Reset all entries and pending runtime env to initial state. */
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
   * the execution's `runtimeEnv`. Cleared on {@link reset}.
   */
  readonly pendingRuntimeEnv: Record<string, EnvVarInput>;

  /**
   * Ready servers as `McpServerUsageInput[]` for session creation.
   *
   * Derived from entries: only `ready` entries are included. When a
   * server's `enabledTools` matches all discovered tools, `enabledTools`
   * is omitted (API convention for "all tools").
   */
  readonly usageInputs: McpServerUsageInput[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the initial enabled tools for a server based on its spec
 * defaults and discovered capabilities.
 *
 * If `default_enabled_tools` is non-empty, uses that subset. Otherwise,
 * enables all discovered tools (empty array when nothing is discovered —
 * equivalent to "all" at runtime).
 */
function computeDefaultEnabledTools(
  mcpServer: McpServer,
  discoveredTools: DiscoveredTool[],
): string[] {
  const defaults = mcpServer.spec?.defaultEnabledTools;
  if (defaults && defaults.length > 0) return [...defaults];
  return discoveredTools.map(t => t.name);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Layer 2 behavior hook that orchestrates the setup flow for multiple
 * MCP servers selected in the {@link McpServerPicker}.
 *
 * When a user toggles an MCP server ON, this hook fetches the server's
 * full resource, checks its `env_spec` against the personal environment
 * (via {@link diffEnvSpec}), and determines whether credentials are
 * needed. It also extracts discovered tools and approval policies for
 * the tool selector UI.
 *
 * The hook supports two credential delivery paths via the `saveForFuture`
 * option on {@link submitEnvVars}:
 * - **Saved** — secrets are persisted to the personal environment for
 *   reuse across sessions.
 * - **One-time** — secrets are collected as `pendingRuntimeEnv` for a
 *   single execution, with no data persisted.
 *
 * State is managed by `useReducer(mcpServerSetupReducer)` — a per-server
 * state machine with four phases:
 * `loading → needsSetup → submitting → ready`.
 *
 * Composes {@link usePersonalEnvironment} for credential persistence and
 * the Stigmer client for MCP server queries.
 *
 * Mirrors the architecture of {@link useAgentSetup} but adapted for
 * multi-server orchestration (N independent entries vs. single agent).
 *
 * Pass `null` as `org` to disable all operations (stable no-op).
 *
 * @param org - Organization slug. Pass `null` to disable.
 * @param poolKeys - Optional set of env-var keys already available
 *   from the session env pool (manual secrets, one-time env vars from
 *   other components). When provided, servers whose `env_spec` keys
 *   are fully covered by `poolKeys` + personal env auto-resolve to
 *   `ready` without prompting. Reactive — when `poolKeys` changes,
 *   `needsSetup` entries are re-evaluated.
 *
 * @example
 * ```tsx
 * const {
 *   entries,
 *   addServer,
 *   submitEnvVars,
 *   setEnabledTools,
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
 * // Customize tools for a ready server:
 * setEnabledTools(ref, ["create_issue", "list_issues"]);
 *
 * // At session creation:
 * const session = await createSession({ mcpServerUsages: usageInputs });
 * ```
 */
export function useMcpServerSetup(
  org: string | null,
  poolKeys?: Set<string>,
): UseMcpServerSetupReturn {
  const stigmer = useStigmer();
  const personalEnv = usePersonalEnvironment(org);

  const [entries, dispatch] = useReducer(
    mcpServerSetupReducer,
    INITIAL_MCP_SETUP_STATE,
  );

  const runtimeEnvRef = useRef<Record<string, EnvVarInput>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

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

      try {
        const mcpServer = await stigmer.mcpServer.getByReference(ref);

        const discoveredTools =
          mcpServer.status?.discoveredCapabilities?.tools ?? [];
        const toolApprovals = mcpServer.spec?.pinnedToolApprovals ?? [];
        const envSpecData = mcpServer.spec?.envSpec?.data;

        if (!envSpecData || Object.keys(envSpecData).length === 0) {
          dispatch({
            type: "RESOLVE_READY",
            key,
            mcpServer,
            discoveredTools,
            toolApprovals,
            enabledTools: computeDefaultEnabledTools(
              mcpServer,
              discoveredTools,
            ),
          });
          return;
        }

        const existingKeys = new Set(
          Object.keys(personalEnv.environment?.spec?.data ?? {}),
        );
        const missingVariables = diffEnvSpec(envSpecData, existingKeys, poolKeys);

        if (missingVariables.length === 0) {
          dispatch({
            type: "RESOLVE_READY",
            key,
            mcpServer,
            discoveredTools,
            toolApprovals,
            enabledTools: computeDefaultEnabledTools(
              mcpServer,
              discoveredTools,
            ),
          });
          return;
        }

        dispatch({
          type: "RESOLVE_NEEDS_SETUP",
          key,
          mcpServer,
          missingVariables,
          discoveredTools,
          toolApprovals,
        });
      } catch (err) {
        dispatch({ type: "SET_ERROR", key, error: toError(err) });
      }
    },
    [org, stigmer, personalEnv, poolKeys],
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

      const { mcpServer, discoveredTools } = entry;
      const enabledTools = computeDefaultEnabledTools(
        mcpServer,
        discoveredTools,
      );
      const saveForFuture = options?.saveForFuture ?? true;

      dispatch({ type: "SUBMIT_START", key });

      if (!saveForFuture) {
        Object.assign(runtimeEnvRef.current, values);
        dispatch({ type: "SUBMIT_DONE", key, enabledTools });
        return;
      }

      try {
        await personalEnv.getOrCreate();
        await personalEnv.addVariables(values);
        dispatch({ type: "SUBMIT_DONE", key, enabledTools });
      } catch (err) {
        dispatch({ type: "SUBMIT_FAIL", key, error: toError(err) });
      }
    },
    [org, entries, personalEnv],
  );

  // -------------------------------------------------------------------------
  // setEnabledTools
  // -------------------------------------------------------------------------

  const setEnabledTools = useCallback(
    (ref: ResourceRef, tools: string[]): void => {
      dispatch({
        type: "SET_ENABLED_TOOLS",
        key: toServerKey(ref),
        enabledTools: tools,
      });
    },
    [],
  );

  // -------------------------------------------------------------------------
  // clearError / reset
  // -------------------------------------------------------------------------

  const clearError = useCallback((ref: ResourceRef): void => {
    dispatch({ type: "CLEAR_ERROR", key: toServerKey(ref) });
  }, []);

  const reset = useCallback((): void => {
    dispatch({ type: "RESET" });
    runtimeEnvRef.current = {};
  }, []);

  // -------------------------------------------------------------------------
  // Pool re-evaluation — auto-resolve needsSetup entries when pool changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!poolKeys || poolKeys.size === 0) return;

    const personalKeys = new Set(
      Object.keys(personalEnv.environment?.spec?.data ?? {}),
    );

    for (const [key, entry] of Object.entries(entriesRef.current)) {
      if (entry.status !== "needsSetup") continue;

      const envSpecData = entry.mcpServer.spec?.envSpec?.data;
      if (!envSpecData) continue;

      const missingVariables = diffEnvSpec(envSpecData, personalKeys, poolKeys);
      const enabledTools = computeDefaultEnabledTools(
        entry.mcpServer,
        entry.discoveredTools,
      );
      dispatch({ type: "POOL_RESOLVE", key, missingVariables, enabledTools });
    }
  }, [poolKeys, personalEnv.environment]);

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

      const allNames = entry.discoveredTools.map(t => t.name);
      const isAllEnabled =
        allNames.length === 0 ||
        (entry.enabledTools.length === allNames.length &&
          entry.enabledTools.every(name => allNames.includes(name)));

      const separatorIdx = serverKey.indexOf("/");
      result.push({
        mcpServerRef: {
          org: serverKey.slice(0, separatorIdx),
          slug: serverKey.slice(separatorIdx + 1),
          kind: ApiResourceKind.mcp_server,
        },
        enabledTools: isAllEnabled ? undefined : [...entry.enabledTools],
      });
    }

    return result;
  }, [entries]);

  return {
    entries,
    addServer,
    removeServer,
    submitEnvVars,
    setEnabledTools,
    clearError,
    reset,
    allReady,
    needsSetupCount,
    pendingRuntimeEnv: runtimeEnvRef.current,
    usageInputs,
  };
}
