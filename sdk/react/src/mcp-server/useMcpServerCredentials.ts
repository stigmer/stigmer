"use client";

import { useCallback, useMemo } from "react";
import type { EnvVarInput } from "@stigmer/sdk";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { usePersonalEnvironment } from "../environment/usePersonalEnvironment";
import { diffEnvSpec } from "../environment/diffEnvSpec";
import type { EnvVarFormVariable } from "../environment/EnvVarForm";

export interface UseMcpServerCredentialsReturn {
  /**
   * Variables required by the MCP server that are missing from the
   * user's personal environment. Empty when all variables are present
   * or the server has no `env_spec`.
   *
   * Suitable as direct input to {@link EnvVarForm}.
   */
  readonly missingVariables: EnvVarFormVariable[];
  /** `true` when all required credentials are available. */
  readonly isReady: boolean;
  /** `true` while the personal environment is being fetched. */
  readonly isLoading: boolean;
  /** Error from the personal environment fetch, or `null`. */
  readonly error: Error | null;
  /**
   * Save the provided credentials to the user's personal environment.
   * Creates the personal environment if it doesn't exist yet.
   */
  readonly saveCredentials: (
    values: Record<string, EnvVarInput>,
  ) => Promise<void>;
  /** `true` while a save operation is in flight. */
  readonly isSaving: boolean;
  /** Re-check the personal environment. */
  readonly refetch: () => void;
}

/**
 * Checks the user's personal environment against an MCP server's
 * `env_spec` and provides a mechanism to save missing credentials.
 *
 * Designed for the discovery flow on the MCP server detail page:
 * before triggering discovery, the UI needs to ensure all required
 * environment variables (API keys, tokens) are present. This hook
 * computes the missing set and exposes `saveCredentials` to persist
 * them.
 *
 * Unlike {@link useMcpServerSetup} which manages multi-server setup
 * for session creation, this hook is scoped to a single server and
 * always persists to the personal environment (no one-time option).
 *
 * Pass `null` for `mcpServer` while loading.
 *
 * @example
 * ```tsx
 * const { missingVariables, isReady, saveCredentials, isSaving } =
 *   useMcpServerCredentials("acme", mcpServer);
 *
 * if (!isReady) {
 *   return (
 *     <EnvVarForm
 *       variables={missingVariables}
 *       onSubmit={(values) => saveCredentials(values)}
 *       isSubmitting={isSaving}
 *       hideSaveToggle
 *     />
 *   );
 * }
 * ```
 */
export function useMcpServerCredentials(
  org: string | null,
  mcpServer: McpServer | null,
): UseMcpServerCredentialsReturn {
  const personalEnv = usePersonalEnvironment(org);

  const missingVariables = useMemo(() => {
    if (!mcpServer) return [];
    const envSpecData = mcpServer.spec?.envSpec?.data;
    if (!envSpecData || Object.keys(envSpecData).length === 0) return [];

    const existingKeys = new Set(
      Object.keys(personalEnv.environment?.spec?.data ?? {}),
    );
    return diffEnvSpec(envSpecData, existingKeys);
  }, [mcpServer, personalEnv.environment]);

  const isReady =
    !personalEnv.isLoading && missingVariables.length === 0;

  const saveCredentials = useCallback(
    async (values: Record<string, EnvVarInput>): Promise<void> => {
      await personalEnv.getOrCreate();
      await personalEnv.addVariables(values);
    },
    [personalEnv],
  );

  return {
    missingVariables,
    isReady,
    isLoading: personalEnv.isLoading,
    error: personalEnv.error,
    saveCredentials,
    isSaving: personalEnv.isMutating,
    refetch: personalEnv.refetch,
  };
}
