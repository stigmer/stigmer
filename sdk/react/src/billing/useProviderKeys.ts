"use client";

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { ProviderKey } from "@stigmer/protos/ai/stigmer/billing/providerkey/v1/api_pb";
import {
  DeleteProviderKeyInputSchema,
  ListProviderKeysInputSchema,
  SetProviderKeyInputSchema,
} from "@stigmer/protos/ai/stigmer/billing/providerkey/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useFetch } from "../internal/useFetch.js";

/** The providers an organization may bring its own key for, by their wire names. */
export type ProviderKeyProvider = "anthropic" | "openai";

/** Options for {@link useProviderKeys}. */
export interface UseProviderKeysOptions {
  /** Skip fetching while `false` (stable no-op). Default `true`. */
  readonly enabled?: boolean;
}

/** Return value of {@link useProviderKeys}. */
export interface UseProviderKeysReturn {
  /**
   * The keys that serve the organization, its own and any it inherits from
   * its integrator, without their secrets; `null` before the first
   * successful fetch.
   */
  readonly keys: readonly ProviderKey[] | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that lists an organization's own LLM provider keys.
 *
 * No answer carries a key: each row names the provider, the key's last
 * four characters, who saved it and when, when it last served a call, and
 * whether the organization's plan still lets it be used. A managed
 * organization's list includes its integrator's keys for the providers it
 * holds none of (`inheritedFromOrgId`). Every member may read it
 * (`can_view_billing`).
 *
 * Cloud-only.
 *
 * @example
 * ```tsx
 * const { keys } = useProviderKeys(orgId);
 * ```
 */
export function useProviderKeys(orgId: string | null, options?: UseProviderKeysOptions): UseProviderKeysReturn {
  const stigmer = useStigmer();
  const enabled = (options?.enabled ?? true) && orgId !== null && orgId !== "";
  const { data, isLoading, error, refetch } = useFetch(
    enabled && orgId ? () => stigmer.providerkey.list(create(ListProviderKeysInputSchema, { orgId })) : null,
    [enabled, orgId, stigmer],
    null as { readonly keys: readonly ProviderKey[] } | null,
  );
  const keys = data?.keys ?? null;
  return useMemo(() => ({ keys, isLoading, error, refetch }), [keys, isLoading, error, refetch]);
}

/** Return value of {@link useProviderKeyActions}. */
export interface UseProviderKeyActionsReturn {
  /**
   * Save the organization's key for a provider, replacing any it holds.
   * The provider is asked about the key once first, and a key it rejects is
   * refused. Refused with the `PLAN_UPGRADE_REQUIRED` reason when the
   * organization's plan does not include bring-your-own provider keys.
   * Resolves with the saved key, without its secret.
   */
  readonly setKey: (orgId: string, provider: ProviderKeyProvider, apiKey: string) => Promise<ProviderKey>;
  /** Remove the organization's key for a provider; allowed on every plan. */
  readonly removeKey: (orgId: string, provider: ProviderKeyProvider) => Promise<ProviderKey>;
  /** `true` while a save or a removal is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that saves and removes an organization's own provider
 * keys. The caller needs `can_manage_billing` on the organization (its
 * admins). Refetch {@link useProviderKeys} after a change.
 */
export function useProviderKeyActions(): UseProviderKeyActionsReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(async (call: () => Promise<ProviderKey>): Promise<ProviderKey> => {
    setIsSubmitting(true);
    setError(null);
    try {
      return await call();
    } catch (e) {
      const err = toError(e);
      setError(err);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const setKey = useCallback(
    (orgId: string, provider: ProviderKeyProvider, apiKey: string) =>
      run(() => stigmer.providerkey.set(create(SetProviderKeyInputSchema, { orgId, provider, apiKey }))),
    [run, stigmer.providerkey],
  );
  const removeKey = useCallback(
    (orgId: string, provider: ProviderKeyProvider) =>
      run(() => stigmer.providerkey.delete(create(DeleteProviderKeyInputSchema, { orgId, provider }))),
    [run, stigmer.providerkey],
  );
  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({ setKey, removeKey, isSubmitting, error, clearError }),
    [setKey, removeKey, isSubmitting, error, clearError],
  );
}
