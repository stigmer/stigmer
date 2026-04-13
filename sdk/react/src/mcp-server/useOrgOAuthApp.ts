"use client";

import { useCallback, useEffect, useState } from "react";
import { create } from "@bufbuild/protobuf";
import {
  GetOrgOAuthAppInputSchema,
  SetOrgOAuthAppInputSchema,
  DeleteOrgOAuthAppInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useOrgOAuthApp}. */
export interface UseOrgOAuthAppReturn {
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

const IDLE: UseOrgOAuthAppReturn = {
  hasOverride: false,
  oauthAppId: null,
  clientId: null,
  isLoading: false,
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

  const [hasOverride, setHasOverride] = useState(false);
  const [oauthAppId, setOauthAppId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const [isSetting, setIsSetting] = useState(false);
  const [setError_, setSetError] = useState<Error | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<Error | null>(null);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  const clearErrors = useCallback(() => {
    setSetError(null);
    setDeleteError(null);
  }, []);

  useEffect(() => {
    if (!resourceId || !org) {
      setHasOverride(false);
      setOauthAppId(null);
      setClientId(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const cancelled = { current: false };
    setIsLoading(true);
    setError(null);

    stigmer.mcpServer
      .getOrgOAuthApp(
        create(GetOrgOAuthAppInputSchema, { resourceId, org }),
      )
      .then(
        (result) => {
          if (cancelled.current) return;
          setHasOverride(result.hasOverride);
          setOauthAppId(result.oauthAppId || null);
          setClientId(result.clientId || null);
          setIsLoading(false);
        },
        (err) => {
          if (cancelled.current) return;
          setError(toError(err));
          setIsLoading(false);
        },
      );

    return () => {
      cancelled.current = true;
    };
  }, [resourceId, org, stigmer, fetchKey]);

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
    hasOverride,
    oauthAppId,
    clientId,
    isLoading,
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
