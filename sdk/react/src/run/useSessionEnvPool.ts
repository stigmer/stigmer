"use client";

/**
 * useSessionEnvPool: the values a composer has gathered for one run, from
 * every place it gathers them (session variables, values typed for one
 * run for the agent or for an MCP server), so a key typed in one place is
 * recognised as given in the others and never asked twice. Values a
 * person saved in a credential are not in the pool: the setup hooks read
 * those per declarer, the way a run does.
 */
import { useMemo } from "react";
import type { EnvVarInput } from "@stigmer/sdk";
import type { SessionVariableEntry } from "../run/useSessionVariables.js";

/**
 * Inputs to the session env pool from all env-var sources.
 *
 * The pool aggregates keys and values from manual session variables,
 * agent one-time env vars, and MCP server pending runtime env. Any source
 * can be omitted — the pool gracefully handles `undefined` inputs.
 */
export interface SessionEnvPoolInput {
  /** Manual session variable entries from {@link useSessionVariables}. */
  readonly manualSecrets?: readonly SessionVariableEntry[];
  /** Agent one-time runtime env (when resolution mode is `"oneTime"`). */
  readonly agentRuntimeEnv?: Readonly<Record<string, EnvVarInput>>;
  /** MCP server pending runtime env (accumulated one-time values). */
  readonly mcpRuntimeEnv?: Readonly<Record<string, EnvVarInput>>;
}

/** Return value of {@link useSessionEnvPool}. */
export interface UseSessionEnvPoolReturn {
  /**
   * All env var keys currently available from any source.
   *
   * Includes keys from valid manual secrets, agent one-time env, and MCP
   * pending env. Reactive — recomputes
   * when any source changes.
   */
  readonly availableKeys: Set<string>;

  /**
   * Look up a value by key from the pool.
   *
   * Priority order (last-write-wins, matching submit merge order):
   * 1. Agent one-time runtime env
   * 2. MCP server pending runtime env
   * 3. Manual session variables (highest priority)
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
 *
 * const pool = useSessionEnvPool({ manualSecrets: sessionVars.entries });
 *
 * // pool.isKeySatisfied("GITHUB_TOKEN") → true if entered anywhere
 * ```
 */
export function useSessionEnvPool(
  input: SessionEnvPoolInput,
): UseSessionEnvPoolReturn {
  const {
    manualSecrets,
    agentRuntimeEnv,
    mcpRuntimeEnv,
  } = input;

  const valueMap = useMemo(() => {
    const map = new Map<string, EnvVarInput>();

    if (agentRuntimeEnv) {
      for (const [key, value] of Object.entries(agentRuntimeEnv)) {
        map.set(key, value);
      }
    }

    if (mcpRuntimeEnv) {
      for (const [key, value] of Object.entries(mcpRuntimeEnv)) {
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
  }, [manualSecrets, agentRuntimeEnv, mcpRuntimeEnv]);

  const availableKeys = useMemo(() => new Set(valueMap.keys()), [valueMap]);

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
