"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import {
  GetOrgOAuthAppInputSchema,
  SetOrgOAuthAppInputSchema,
  DeleteOrgOAuthAppInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { isUnimplemented } from "../internal/isUnimplemented.js";
import { toError } from "../internal/toError.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useOrgOAuthApp}. */
export interface UseOrgOAuthAppReturn {
  /**
   * Whether the backend supports the org-OAuth-app override surface at all.
   *
   * The surface is hosted-only by design: the OSS server answers
   * UNIMPLEMENTED for all three org-override RPCs because its flat
   * OAuthApp store has no override binding (stigmer/stigmer#558 — the
   * self-hosted equivalent is applying an OAuthApp resource and
   * referencing it from `spec.auth.oauth_app_ref`). The fetch doubles
   * as the capability probe: `isSupported` is `false` until the first
   * successful response confirms the surface exists, so BYOA
   * affordances gated on it never flash on deployments where the
   * submit could only fail.
   */
  readonly isSupported: boolean;
  /** Whether an org-level BYOA override exists for this resource + org. */
  readonly hasOverride: boolean;
  /** System-generated ID of the override's OAuthApp, or `null` when absent. */
  readonly oauthAppId: string | null;
  /**
   * Client ID from the override's OAuthApp (non-secret, safe to display).
   * `null` when no override exists. Useful for admin verification of
   * which app registration is active.
   */
  readonly clientId: string | null;
  /** `true` while the override status is being fetched. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed fetch, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the override status. */
  readonly refetch: () => void;

  /**
   * Create or update the org's BYOA OAuth app override.
   *
   * The backend clones endpoint URLs from the platform's OAuthApp template,
   * creates an OAuthApp with the org's credentials, and binds it as the
   * override for this resource. On success, call {@link refetch} to
   * reflect the new state.
   *
   * @returns The system-generated ID of the created/updated OAuthApp.
   */
  readonly setOrgOAuthApp: (
    clientId: string,
    clientSecret: string,
  ) => Promise<string>;
  /** `true` while a set operation is in flight. */
  readonly isSetting: boolean;
  /** Error from the last failed set, or `null`. */
  readonly setError: Error | null;

  /**
   * Remove the org's BYOA override for this resource.
   *
   * Deletes both the override binding and the OAuthApp resource created
   * for it. After deletion, the resolution chain falls back to the
   * platform default. Existing user grants that were issued with the
   * org's OAuthApp will fail on next refresh.
   *
   * @returns `true` when the override was removed.
   */
  readonly deleteOrgOAuthApp: () => Promise<boolean>;
  /** `true` while a delete operation is in flight. */
  readonly isDeleting: boolean;
  /** Error from the last failed delete, or `null`. */
  readonly deleteError: Error | null;

  /** Reset all mutation error states. */
  readonly clearErrors: () => void;
}

interface OrgOAuthAppData {
  isSupported: boolean;
  hasOverride: boolean;
  oauthAppId: string | null;
  clientId: string | null;
}

const IDLE_DATA: OrgOAuthAppData = {
  isSupported: false,
  hasOverride: false,
  oauthAppId: null,
  clientId: null,
};

/**
 * The UNIMPLEMENTED answer resolved into data rather than an error:
 * the backend is healthy, it just doesn't have this edition capability.
 */
const UNSUPPORTED_DATA: OrgOAuthAppData = {
  isSupported: false,
  hasOverride: false,
  oauthAppId: null,
  clientId: null,
};

const IDLE: UseOrgOAuthAppReturn = {
  ...IDLE_DATA,
  isLoading: false,
  isRefetching: false,
  error: null,
  refetch: () => {},
  setOrgOAuthApp: () => Promise.resolve(""),
  isSetting: false,
  setError: null,
  deleteOrgOAuthApp: () => Promise.resolve(false),
  isDeleting: false,
  deleteError: null,
  clearErrors: () => {},
};

/**
 * Hybrid data + behavior hook for managing org-level BYOA OAuth app overrides.
 *
 * **Data side**: Auto-fetches `getOrgOAuthApp` when both parameters are
 * non-null. Returns override existence, OAuthApp ID, and client ID for
 * display. Follows the same fetch-on-mount pattern as
 * {@link useOAuthGrantStatus}.
 *
 * **Behavior side**: Exposes `setOrgOAuthApp` and `deleteOrgOAuthApp`
 * mutations bound to the hook's resource + org context, eliminating
 * parameter repetition at call sites.
 *
 * **Edition awareness**: the fetch doubles as a capability probe. The
 * org-override surface is hosted-only; the OSS server answers
 * UNIMPLEMENTED for it, which this hook resolves into
 * `isSupported: false` with no error. Gate every BYOA affordance on
 * `isSupported` (as {@link useMcpServerCredentials} does for
 * `canBringOwnApp`) — the mutations can only fail where the probe
 * reports the surface absent.
 *
 * Pass `null` for either parameter to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const orgApp = useOrgOAuthApp(mcpServer?.metadata?.id ?? null, org);
 *
 * if (orgApp.hasOverride) {
 *   return <span>Using your OAuth app (client: {orgApp.clientId})</span>;
 * }
 *
 * const handleSubmit = async (clientId: string, clientSecret: string) => {
 *   await orgApp.setOrgOAuthApp(clientId, clientSecret);
 *   orgApp.refetch();
 *   credentials.refetch();
 * };
 * ```
 */
export function useOrgOAuthApp(
  resourceId: string | null,
  org: string | null,
): UseOrgOAuthAppReturn {
  const stigmer = useStigmer();

  const { data, isLoading, isRefetching, error, refetch } = useFetch<OrgOAuthAppData>(
    resourceId && org
      ? async () => {
          try {
            const result = await stigmer.mcpServer.getOrgOAuthApp(
              create(GetOrgOAuthAppInputSchema, { resourceId, org }),
            );
            return {
              isSupported: true,
              hasOverride: result.hasOverride,
              oauthAppId: result.oauthAppId || null,
              clientId: result.clientId || null,
            };
          } catch (err) {
            if (isUnimplemented(err)) return UNSUPPORTED_DATA;
            throw err;
          }
        }
      : null,
    [resourceId, org, stigmer],
    IDLE_DATA,
    // Cross-mount cache: the credentials hook composes this fetch as its
    // capability probe, so a detail page mounts two instances — the cache
    // lets the second render from the first's result.
    { cacheKey: `org-oauth-app:${org}:${resourceId}` },
  );

  const [isSetting, setIsSetting] = useState(false);
  const [setError_, setSetError] = useState<Error | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<Error | null>(null);

  const clearErrors = useCallback(() => {
    setSetError(null);
    setDeleteError(null);
  }, []);

  const setOrgOAuthApp = useCallback(
    async (newClientId: string, clientSecret: string): Promise<string> => {
      if (!resourceId || !org) {
        throw new Error(
          "useOrgOAuthApp: resourceId and org are required for setOrgOAuthApp",
        );
      }
      setIsSetting(true);
      setSetError(null);

      try {
        const result = await stigmer.mcpServer.setOrgOAuthApp(
          create(SetOrgOAuthAppInputSchema, {
            resourceId,
            org,
            clientId: newClientId,
            clientSecret,
          }),
        );
        return result.oauthAppId;
      } catch (err) {
        const wrapped = toError(err);
        setSetError(wrapped);
        throw wrapped;
      } finally {
        setIsSetting(false);
      }
    },
    [stigmer, resourceId, org],
  );

  const deleteOrgOAuthApp = useCallback(async (): Promise<boolean> => {
    if (!resourceId || !org) {
      throw new Error(
        "useOrgOAuthApp: resourceId and org are required for deleteOrgOAuthApp",
      );
    }
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const result = await stigmer.mcpServer.deleteOrgOAuthApp(
        create(DeleteOrgOAuthAppInputSchema, { resourceId, org }),
      );
      return result.deleted;
    } catch (err) {
      const wrapped = toError(err);
      setDeleteError(wrapped);
      throw wrapped;
    } finally {
      setIsDeleting(false);
    }
  }, [stigmer, resourceId, org]);

  if (!resourceId || !org) return { ...IDLE, refetch, clearErrors };

  return {
    ...data,
    isLoading,
    isRefetching,
    error,
    refetch,
    setOrgOAuthApp,
    isSetting,
    setError: setError_,
    deleteOrgOAuthApp,
    isDeleting,
    deleteError,
    clearErrors,
  };
}
