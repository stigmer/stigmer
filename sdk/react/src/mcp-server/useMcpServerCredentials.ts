"use client";

import { useCallback, useMemo } from "react";
import type { EnvVarInput } from "@stigmer/sdk";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { usePersonalEnvironment } from "../environment/usePersonalEnvironment";
import { diffEnvSpec } from "../environment/diffEnvSpec";
import { SYSTEM_ENV_VAR_KEYS } from "../environment/systemEnvVars";
import type { EnvVarFormVariable } from "../environment/EnvVarForm";

/**
 * Credential acquisition mode for an MCP server.
 *
 * - `"manual"` — all env vars are entered by the user via a form.
 * - `"oauth"` — at least one env var (`target_env_var`) is acquired
 *   via OAuth. Additional manual vars may still be required (mixed mode).
 */
export type McpServerAuthMode = "manual" | "oauth";

/** Return value of {@link useMcpServerCredentials}. */
export interface UseMcpServerCredentialsReturn {
  /**
   * Credential acquisition mode derived from `spec.auth`.
   *
   * - `"manual"` when `spec.auth` is absent: all env vars are user-entered.
   * - `"oauth"` when `spec.auth` is present: the `target_env_var` is
   *   acquired via OAuth. Check {@link missingVariables} for any
   *   additional manual vars that are also needed (mixed mode).
   */
  readonly authMode: McpServerAuthMode;
  /**
   * The env var name managed by OAuth, or `null` when `authMode` is `"manual"`.
   * Corresponds to `spec.auth.target_env_var`.
   */
  readonly oauthTargetEnvVar: string | null;
  /**
   * `true` when the OAuth-managed env var exists in the personal
   * environment. Always `false` when `authMode` is `"manual"`.
   */
  readonly isOAuthConnected: boolean;
  /**
   * Informational hint about expected token lifetime, or `null`.
   * Sourced from `spec.auth.token_lifetime_hint`.
   */
  readonly tokenLifetimeHint: string | null;
  /**
   * Variables required by the MCP server that are missing from the
   * user's personal environment. Empty when all variables are present
   * or the server has no `env_spec`.
   *
   * When `authMode` is `"oauth"`, the OAuth-managed `target_env_var`
   * is excluded from this list — it is acquired via the OAuth flow,
   * not via a manual form. Only additional non-OAuth vars appear here.
   *
   * Suitable as direct input to {@link EnvVarForm}.
   */
  readonly missingVariables: EnvVarFormVariable[];
  /**
   * `true` when all required credentials are available — both
   * OAuth-managed and manual variables. For OAuth servers this means
   * the OAuth token is in the personal env AND any additional manual
   * vars are also present.
   */
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
 * **Auth-mode-aware**: when `spec.auth` is configured, the hook
 * identifies the OAuth-managed variable (`target_env_var`) and
 * excludes it from `missingVariables` — that variable is acquired
 * via {@link useMcpServerOAuthConnect}, not a manual form. Additional
 * non-OAuth vars still appear in `missingVariables` (mixed mode).
 *
 * Unlike {@link useMcpServerSetup} which manages multi-server setup
 * for session creation, this hook is scoped to a single server and
 * always persists to the personal environment (no one-time option).
 *
 * Pass `null` for `mcpServer` while loading.
 *
 * @example
 * ```tsx
 * const creds = useMcpServerCredentials("acme", mcpServer);
 *
 * // OAuth server — sign-in button + optional manual form
 * if (creds.authMode === "oauth" && !creds.isOAuthConnected) {
 *   return <button onClick={startOAuth}>Sign in</button>;
 * }
 *
 * // Manual vars still needed (mixed mode or manual-only)
 * if (creds.missingVariables.length > 0) {
 *   return (
 *     <EnvVarForm
 *       variables={creds.missingVariables}
 *       onSubmit={(values) => creds.saveCredentials(values)}
 *       isSubmitting={creds.isSaving}
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

  const auth = mcpServer?.spec?.auth;
  const authMode: McpServerAuthMode = auth ? "oauth" : "manual";
  const oauthTargetEnvVar = auth?.targetEnvVar || null;
  const tokenLifetimeHint = auth?.tokenLifetimeHint || null;

  const existingKeys = useMemo(
    () => new Set(Object.keys(personalEnv.environment?.spec?.data ?? {})),
    [personalEnv.environment],
  );

  const isOAuthConnected = authMode === "oauth"
    && oauthTargetEnvVar !== null
    && existingKeys.has(oauthTargetEnvVar);

  const allMissingVariables = useMemo(() => {
    if (!mcpServer) return [];
    const envSpecData = mcpServer.spec?.envSpec?.data;
    if (!envSpecData || Object.keys(envSpecData).length === 0) return [];

    return diffEnvSpec(envSpecData, existingKeys).filter(
      (v) => !SYSTEM_ENV_VAR_KEYS.has(v.key),
    );
  }, [mcpServer, existingKeys]);

  const missingVariables = useMemo(() => {
    if (!oauthTargetEnvVar) return allMissingVariables;
    return allMissingVariables.filter((v) => v.key !== oauthTargetEnvVar);
  }, [allMissingVariables, oauthTargetEnvVar]);

  const isReady =
    !personalEnv.isLoading && allMissingVariables.length === 0;

  const saveCredentials = useCallback(
    async (values: Record<string, EnvVarInput>): Promise<void> => {
      await personalEnv.getOrCreate();
      await personalEnv.addVariables(values);
    },
    [personalEnv],
  );

  return {
    authMode,
    oauthTargetEnvVar,
    isOAuthConnected,
    tokenLifetimeHint,
    missingVariables,
    isReady,
    isLoading: personalEnv.isLoading,
    error: personalEnv.error,
    saveCredentials,
    isSaving: personalEnv.isMutating,
    refetch: personalEnv.refetch,
  };
}
