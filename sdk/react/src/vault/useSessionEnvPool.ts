"use client";

/**
 * The pool of values a conversation already has, from every source the
 * composer collects, so one entry is never asked for twice.
 */

import { useMemo } from "react";
import type { EnvVarInput } from "./types.js";
import type { SessionVariableEntry } from "../run/useSessionVariables.js";

/**
 * Inputs to the session env pool from all env-var sources.
 *
 * The pool aggregates keys from My vault and values from manual session
 * variables, agent one-time values and MCP server one-time values. Any
 * source can be omitted — the pool gracefully handles `undefined` inputs.
 */
export interface SessionEnvPoolInput {
  /** Secret names already saved in the user's My vault (values are never read). */
  readonly savedKeys?: ReadonlySet<string>;
  /** Manual session variable entries from {@link useSessionVariables}. */
  readonly manualSecrets?: readonly SessionVariableEntry[];
  /** Agent one-time values (when resolution mode is `"oneTime"`). */
  readonly agentOneTimeValues?: Readonly<Record<string, EnvVarInput>>;
  /** MCP server one-time values (accumulated before submit). */
  readonly mcpOneTimeValues?: Readonly<Record<string, EnvVarInput>>;
}

/** Return value of {@link useSessionEnvPool}. */
export interface UseSessionEnvPoolReturn {
  /**
   * All env var keys currently available from any source.
   *
   * Includes secret names saved in My vault, valid manual secrets,
   * agent one-time values, and MCP one-time values. Reactive — recomputes
   * when any source changes.
   */
  readonly availableKeys: Set<string>;

  /**
   * Look up a value by key from the pool.
   *
   * Priority order (last-write-wins, matching submit merge order):
   * 1. My vault names (values are never read — returns `undefined`)
   * 2. Agent one-time values
   * 3. MCP server one-time values
   * 4. Manual session variables (highest priority)
   *
   * Returns `undefined` if the key is not in the pool.
   */
  readonly getAvailableValue: (key: string) => EnvVarInput | undefined;

  /**
   * Check if a key is satisfied by any source in the pool.
   *
   * Equivalent to `availableKeys.has(key)` but provided for
   * semantic clarity.
   */
  readonly isKeySatisfied: (key: string) => boolean;
}

/**
 * Reactive computation hook that aggregates environment variable
 * availability from all session-level sources.
 *
 * The pool enables cross-referencing between the session variables
 * panel, agent env form, and MCP server env form — so a variable
 * entered in one place is recognized as "already provided" by the
 * others. This eliminates duplicate credential prompting.
 *
 * Pure computation — no side effects, no API calls. Recomputes
 * via `useMemo` when any input source changes.
 *
 * Platform builders who use individual setup hooks can pass the
 * pool's `availableKeys` to `useMcpServerSetup` and `useAgentSetup`
 * via their `poolKeys` parameter for cross-referencing.
 *
 * @example
 * ```tsx
 * const sessionVars = useSessionVariables();
 * const myVault = useMyVault(org);
 *
 * const pool = useSessionEnvPool({
 *   savedKeys: myVault.secretNames,
 *   manualSecrets: sessionVars.entries,
 * });
 *
 * // pool.isKeySatisfied("GITHUB_TOKEN") → true if entered anywhere
 * ```
 */
export function useSessionEnvPool(
  input: SessionEnvPoolInput,
): UseSessionEnvPoolReturn {
  const {
    savedKeys,
    manualSecrets,
    agentOneTimeValues,
    mcpOneTimeValues,
  } = input;

  const valueMap = useMemo(() => {
    const map = new Map<string, EnvVarInput>();

    if (agentOneTimeValues) {
      for (const [key, value] of Object.entries(agentOneTimeValues)) {
        map.set(key, value);
      }
    }

    if (mcpOneTimeValues) {
      for (const [key, value] of Object.entries(mcpOneTimeValues)) {
        map.set(key, value);
      }
    }

    if (manualSecrets) {
      for (const entry of manualSecrets) {
        const k = entry.key.trim();
        if (k !== "" && entry.value.trim() !== "") {
          map.set(k, { value: entry.value, isSecret: entry.isSecret });
        }
      }
    }

    return map;
  }, [manualSecrets, agentOneTimeValues, mcpOneTimeValues]);

  const availableKeys = useMemo(() => {
    const keys = new Set<string>();

    if (savedKeys) {
      for (const key of savedKeys) {
        keys.add(key);
      }
    }

    for (const key of valueMap.keys()) {
      keys.add(key);
    }

    return keys;
  }, [savedKeys, valueMap]);

  const getAvailableValue = useMemo(
    () => (key: string): EnvVarInput | undefined => valueMap.get(key),
    [valueMap],
  );

  const isKeySatisfied = useMemo(
    () => (key: string): boolean => availableKeys.has(key),
    [availableKeys],
  );

  return { availableKeys, getAvailableValue, isKeySatisfied };
}
