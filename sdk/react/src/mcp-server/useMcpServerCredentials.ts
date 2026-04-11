"use client";

import { useCallback, useMemo } from "react";
import type { EnvVarInput } from "@stigmer/sdk";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { usePersonalEnvironment } from "../environment/usePersonalEnvironment";
import { diffEnv } from "../environment/diffEnv";
import { SYSTEM_ENV_VAR_KEYS } from "../environment/systemEnvVars";
import type { EnvVarFormVariable } from "../environment/EnvVarForm";
import { useOAuthGrantStatus } from "./useOAuthGrantStatus";

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
   * `true` when the user has an active OAuth grant for this server.
   * Derived from the `getOAuthGrantStatus` API, not from personal
   * environment key presence. Always `false` when `authMode` is `"manual"`.
   */
  readonly isOAuthConnected: boolean;
  /**
   * When the OAuth access token expires (Unix timestamp seconds).
   * `BigInt(0)` when no grant exists, `authMode` is `"manual"`, or the token
   * does not expire. Useful for showing actual expiry in the UI.
   */
  readonly accessTokenExpiresAt: bigint;
  /**
   * Informational hint about expected token lifetime, or `null`.
   * Sourced from `spec.auth.token_lifetime_hint`.
   */
  readonly tokenLifetimeHint: string | null;
  /**
   * Required variables (non-optional) missing from the user's personal
   * environment. Empty when all required variables are present, the
   * server has no `env` declarations, or all declarations are optional.
   *
   * When `authMode` is `"oauth"`, the OAuth-managed `target_env_var`
   * is excluded from this list — it is acquired via the OAuth flow,
   * not via a manual form. Only additional non-OAuth required vars
   * appear here.
   *
   * Optional env vars are never included — they are discoverable in
   * the read-only EnvSection but do not block connect.
   *
   * Suitable as direct input to {@link EnvVarForm}.
   */
  readonly missingVariables: EnvVarFormVariable[];
  /**
   * `true` when all required (non-optional) credentials are available
   * — both OAuth-managed and manual variables. For OAuth servers this
   * means the OAuth grant is connected AND any additional required
   * manual vars are present in the personal environment.
   *
   * Servers whose env vars are all optional are always ready.
   */
  readonly isReady: boolean;
  /** `true` while the personal environment or grant status is being fetched. */
  readonly isLoading: boolean;
  /** Error from the personal environment or grant status fetch, or `null`. */
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
 * `env` declarations and provides a mechanism to save missing credentials.
 *
 * Designed for the discovery flow on the MCP server detail page:
 * before triggering discovery, the UI needs to ensure all required
 * environment variables (API keys, tokens) are present. This hook
 * computes the missing set and exposes `saveCredentials` to persist
 * them.
 *
 * **Auth-mode-aware**: when `spec.auth` is configured, the hook
 * composes {@link useOAuthGrantStatus} to determine whether the
 * OAuth-managed variable (`target_env_var`) is connected via an
 * active grant. The OAuth variable is excluded from `missingVariables`
 * — it is acquired via {@link useMcpServerOAuthConnect}, not a manual
 * form. Additional non-OAuth vars still appear in `missingVariables`
 * (mixed mode).
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

  const grantStatus = useOAuthGrantStatus(
    authMode === "oauth" ? (mcpServer?.metadata?.id ?? null) : null,
    authMode === "oauth" ? org : null,
  );

  const isOAuthConnected = authMode === "oauth" && grantStatus.connected;

  const existingKeys = useMemo(
    () => new Set(Object.keys(personalEnv.environment?.spec?.data ?? {})),
    [personalEnv.environment],
  );

  const allMissingVariables = useMemo(() => {
    if (!mcpServer) return [];
    const envDeclarations = mcpServer.spec?.env;
    if (!envDeclarations || Object.keys(envDeclarations).length === 0) return [];

    return diffEnv(envDeclarations, existingKeys).filter(
      (v) => !SYSTEM_ENV_VAR_KEYS.has(v.key),
    );
  }, [mcpServer, existingKeys]);

  const requiredMissing = useMemo(
    () => allMissingVariables.filter((v) => !v.optional),
    [allMissingVariables],
  );

  const missingVariables = useMemo(() => {
    if (!oauthTargetEnvVar) return requiredMissing;
    return requiredMissing.filter((v) => v.key !== oauthTargetEnvVar);
  }, [requiredMissing, oauthTargetEnvVar]);

  const isReady =
    !personalEnv.isLoading &&
    !grantStatus.isLoading &&
    missingVariables.length === 0 &&
    (authMode === "manual" || isOAuthConnected);

  const saveCredentials = useCallback(
    async (values: Record<string, EnvVarInput>): Promise<void> => {
      await personalEnv.getOrCreate();
      await personalEnv.addVariables(values);
    },
    [personalEnv],
  );

  const refetch = useCallback(() => {
    personalEnv.refetch();
    grantStatus.refetch();
  }, [personalEnv, grantStatus]);

  return {
    authMode,
    oauthTargetEnvVar,
    isOAuthConnected,
    accessTokenExpiresAt: grantStatus.accessTokenExpiresAt,
    tokenLifetimeHint,
    missingVariables,
    isReady,
    isLoading: personalEnv.isLoading || grantStatus.isLoading,
    error: personalEnv.error ?? grantStatus.error,
    saveCredentials,
    isSaving: personalEnv.isMutating,
    refetch,
  };
}
