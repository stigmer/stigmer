"use client";

import { useCallback, useMemo, useState } from "react";
import type { EnvVarInput } from "../vault/types.js";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { VendorApprovalStatus } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { useMyVault } from "../vault/useMyVault.js";
import { toolAddressOf, toolLoginKeyOf, vaultLoginServes } from "../vault/address.js";
import { valuesOf } from "../vault/types.js";
import { diffEnv } from "../vault/diffEnv.js";
import { SYSTEM_ENV_VAR_KEYS } from "../vault/systemEnvVars.js";
import type { EnvVarFormVariable } from "../vault/EnvVarForm.js";
import { useOAuthGrantStatus } from "./useOAuthGrantStatus.js";

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
   * `true` when My vault holds a login a run would fill this server's
   * `target_env_var` from: a sign-in made for this server (the
   * `getOAuthGrantStatus` API), or a login the person saved themselves (a
   * token pasted at an HTTP tool's own URL, or a secret by the variable's
   * name). Always `false` when `authMode` is `"manual"`.
   */
  readonly isOAuthConnected: boolean;
  /**
   * Health of the OAuth connection for this server.
   *
   * Provides a four-state signal beyond the binary `isOAuthConnected`:
   * healthy, expired-but-refreshable, expired (re-auth needed), or no
   * grant. `UNSPECIFIED` when `authMode` is `"manual"` or the status
   * has not been fetched yet.
   */
  readonly connectionHealth: OAuthConnectionHealth;
  /**
   * `true` when the user can disconnect (i.e., an OAuth grant exists).
   * Always `false` when `authMode` is `"manual"` or no grant is present,
   * a login the person saved themselves included.
   */
  readonly canDisconnect: boolean;
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
   * Required variables (non-optional) the user's My vault does not fill. Empty when all required variables are present, the
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
   * means a login is connected ({@link isOAuthConnected}) AND any
   * additional required manual vars are saved in My vault.
   *
   * Servers whose env vars are all optional are always ready.
   */
  readonly isReady: boolean;
  /**
   * `true` while My vault or the sign-in status is being fetched.
   */
  readonly isLoading: boolean;
  /**
   * Error from My vault or the sign-in status, or `null`.
   */
  readonly error: Error | null;
  /**
   * Save the provided credentials in the user's My vault (created by the
   * server on the first save). For an HTTP server, a value for the tool's
   * login variable is saved as a login at the tool's URL; every other
   * value, and every value for a local program, as a secret by its name.
   */
  readonly saveCredentials: (
    values: Record<string, EnvVarInput>,
  ) => Promise<void>;
  /** `true` while a save operation is in flight. */
  readonly isSaving: boolean;
  /** Re-check My vault and the sign-in status. */
  readonly refetch: () => void;
  /**
   * `true` when the vendor approval of the organization's login app for
   * this server's address is still pending. When pending, sign-in is
   * unavailable and the sign-in button should be disabled. Users can still
   * connect via manual token entry (manual override).
   */
  readonly isVendorApprovalPending: boolean;
  /**
   * Documentation URL for users while the login app is pending vendor
   * approval. `null` when no documentation link is available.
   */
  readonly vendorApprovalDocsUrl: string | null;
  /**
   * `true` when the login app's vendor approval is PENDING or REJECTED —
   * i.e., sign-in is blocked. Covers both statuses since the user-facing
   * behavior is the same: sign-in is disabled and manual entry (or an
   * admin adding another login app for the address) is the alternative.
   *
   * See also {@link isVendorApprovalPending} which only checks PENDING.
   */
  readonly isVendorApprovalBlocked: boolean;
  /**
   * `true` when a manually-entered static token is a valid way to
   * authenticate this server. `false` for `oauth_only` servers whose
   * hosted endpoint rejects static tokens (`spec.auth.oauth_only`), where
   * OAuth is the sole credential path.
   *
   * Connect surfaces use this to decide whether to offer the "enter token
   * manually" affordance — offering it on an `oauth_only` server would send
   * the user down a path that cannot succeed. Always `true` for manual-only
   * and PAT-capable servers.
   */
  readonly manualEntrySupported: boolean;
  /**
   * When `true`, the user has opted to bypass OAuth and enter the
   * `target_env_var` token manually. In this state:
   *
   * - {@link missingVariables} includes the OAuth-managed variable
   * - {@link isReady} no longer requires an active OAuth grant
   *
   * Only meaningful when `authMode` is `"oauth"`. Has no effect on
   * manual-only servers.
   */
  readonly manualOverride: boolean;
  /**
   * Toggle the manual override. Pass `true` to switch from OAuth to
   * manual token entry; `false` to revert to the OAuth flow.
   */
  readonly setManualOverride: (override: boolean) => void;
}

/**
 * Checks the user's My vault against an MCP server's `env` declarations
 * and provides a mechanism to save missing credentials. Values are never
 * read: a variable counts as provided when My vault holds a secret by its
 * name, or, for the tool's login variable, a login a run would fill it from
 * ({@link vaultLoginServes}: a sign-in or a pasted login at an HTTP
 * server's own URL; a local program takes its keys as secrets).
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
 * always saves into My vault (no one-time option).
 *
 * Pass `null` for `mcpServer` while loading.
 *
 * @example
 * ```tsx
 * const creds = useMcpServerCredentials("acme", mcpServer);
 *
 * // OAuth server — sign-in button + manual override escape hatch
 * if (creds.authMode === "oauth" && !creds.isOAuthConnected) {
 *   if (creds.manualOverride) {
 *     // User opted to enter the token manually
 *     return (
 *       <>
 *         <EnvVarForm
 *           variables={creds.missingVariables}
 *           onSubmit={(values) => creds.saveCredentials(values)}
 *           isSubmitting={creds.isSaving}
 *         />
 *         <button onClick={() => creds.setManualOverride(false)}>
 *           Sign in with OAuth instead
 *         </button>
 *       </>
 *     );
 *   }
 *   return (
 *     <>
 *       <button onClick={startOAuth}>Sign in</button>
 *       <button onClick={() => creds.setManualOverride(true)}>
 *         Enter token manually
 *       </button>
 *     </>
 *   );
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
  const myVault = useMyVault(org);
  const [manualOverride, setManualOverride] = useState(false);

  const auth = mcpServer?.spec?.auth;
  const authMode: McpServerAuthMode = auth ? "oauth" : "manual";
  const oauthTargetEnvVar = auth?.targetEnvVar || null;
  const tokenLifetimeHint = auth?.tokenLifetimeHint || null;

  // A static token is a valid credential for every server except those whose
  // endpoint declares it rejects them (`oauth_only`). This is the single source
  // of truth the connect surfaces consult before offering manual entry.
  const manualEntrySupported = !auth?.oauthOnly;
  // Defensively force manual override off for oauth_only servers so no surface
  // can enter a dead-end manual-entry state, even if a stale toggle is set.
  const effectiveManualOverride = manualOverride && manualEntrySupported;

  const oauthStatus = mcpServer?.status?.oauthStatus;
  const isVendorApprovalPending =
    authMode === "oauth" &&
    oauthStatus?.vendorApprovalStatus === VendorApprovalStatus.PENDING;
  const isVendorApprovalBlocked =
    authMode === "oauth" &&
    (oauthStatus?.vendorApprovalStatus === VendorApprovalStatus.PENDING ||
      oauthStatus?.vendorApprovalStatus === VendorApprovalStatus.REJECTED);
  const vendorApprovalDocsUrl = oauthStatus?.vendorApprovalDocsUrl || null;

  const grantStatus = useOAuthGrantStatus(
    authMode === "oauth" ? (mcpServer?.metadata?.id ?? null) : null,
    authMode === "oauth" ? org : null,
  );

  const existingKeys = useMemo(
    () => savedKeysFor(mcpServer, myVault.vault),
    [mcpServer, myVault.vault],
  );

  // The grant reports a sign-in at the server's address. A run also fills
  // the login from what My vault holds otherwise (a token pasted at the
  // tool's own URL, or a secret by the variable's name), so that counts as
  // connected too.
  const isOAuthConnected =
    authMode === "oauth" &&
    (grantStatus.connected || (oauthTargetEnvVar !== null && existingKeys.has(oauthTargetEnvVar)));

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
    if (!oauthTargetEnvVar || effectiveManualOverride) return requiredMissing;
    return requiredMissing.filter((v) => v.key !== oauthTargetEnvVar);
  }, [requiredMissing, oauthTargetEnvVar, effectiveManualOverride]);

  const isReady =
    !myVault.isLoading &&
    !grantStatus.isLoading &&
    missingVariables.length === 0 &&
    (authMode === "manual" || effectiveManualOverride || isOAuthConnected);

  const saveCredentials = useCallback(
    async (values: Record<string, EnvVarInput>): Promise<void> => {
      await saveToMyVault(myVault, values, mcpServer);
      grantStatus.refetch();
    },
    [myVault, mcpServer, grantStatus],
  );

  const refetch = useCallback(() => {
    myVault.refetch();
    grantStatus.refetch();
  }, [myVault, grantStatus]);

  return {
    authMode,
    oauthTargetEnvVar,
    isOAuthConnected,
    connectionHealth: grantStatus.connectionHealth,
    canDisconnect: authMode === "oauth" && grantStatus.connected,
    accessTokenExpiresAt: grantStatus.accessTokenExpiresAt,
    tokenLifetimeHint,
    isVendorApprovalPending,
    isVendorApprovalBlocked,
    vendorApprovalDocsUrl,
    manualEntrySupported,
    missingVariables,
    isReady,
    isLoading: myVault.isLoading || grantStatus.isLoading,
    error: myVault.error ?? grantStatus.error,
    saveCredentials,
    isSaving: myVault.isMutating,
    refetch,
    manualOverride: effectiveManualOverride,
    setManualOverride,
  };
}

/**
 * The variables a vault already fills for a server, by the run's rule: its
 * secrets by name, plus the server's login variable when it holds a login
 * that serves this server ({@link vaultLoginServes}). Names and connection
 * kinds only; no read returns a value. Shared by every surface that asks
 * for a tool's credentials against My vault.
 */
export function savedKeysFor(mcpServer: McpServer | null, vault: Vault | null): Set<string> {
  const keys = new Set(Object.keys(vault?.spec?.secrets ?? {}));
  const loginKey = toolLoginKeyOf(mcpServer);
  if (loginKey && vaultLoginServes(vault?.spec?.connections ?? {}, mcpServer)) keys.add(loginKey);
  return keys;
}

/**
 * Saves collected values in My vault. For an HTTP server, the tool's login
 * variable is saved as a login at the tool's URL (where a run's matching
 * finds it first, and where it reaches only that URL). Every other value is
 * saved as a secret by its name, and so is every value for a local program:
 * its address is a discovery URL any definition may declare, so a run never
 * fills it from a pasted login there, only from a secret by name. Shared by
 * every surface that saves a tool's credentials.
 */
export async function saveToMyVault(
  myVault: Pick<ReturnType<typeof useMyVault>, "setSecrets" | "setConnection">,
  values: Readonly<Record<string, EnvVarInput>>,
  mcpServer: McpServer | null,
): Promise<void> {
  const rest: Record<string, EnvVarInput> = { ...values };
  const loginKey = toolLoginKeyOf(mcpServer);
  const toolAddress = toolAddressOf(mcpServer);
  if (loginKey && toolAddress && mcpServer?.spec?.serverType.case === "http") {
    const login = rest[loginKey];
    if (login !== undefined && login.value !== "") {
      delete rest[loginKey];
      await myVault.setConnection(toolAddress, login.value);
    }
  }
  const secrets = valuesOf(rest);
  if (Object.keys(secrets).length > 0) {
    await myVault.setSecrets(secrets);
  }
}
