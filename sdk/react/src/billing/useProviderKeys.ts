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
import { LIST_PAGE_MAX, readEveryPage } from "../internal/everyPage.js";
import { useFetch } from "../internal/useFetch.js";

/**
 * The providers an organization holds a key for, by their wire names.
 * `anthropic` is Anthropic's API or any endpoint that speaks it, `openai` is
 * OpenAI's or any endpoint that speaks it; `cursor` is a Cursor user API key
 * or team service-account key, served from Cursor's own hosts and saved
 * without a base URL.
 */
export type ProviderKeyProvider = "anthropic" | "openai" | "cursor";

/** Options for {@link useProviderKeys}. */
export interface UseProviderKeysOptions {
  /** Skip fetching while `false` (stable no-op). Default `true`. */
  readonly enabled?: boolean;
}

/** Return value of {@link useProviderKeys}. */
export interface UseProviderKeysReturn {
  /**
   * The keys that serve the organization, its own and any it inherits from
   * its parent organization, without their secrets; `null` before the first
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
 * Data hook that lists an organization's own provider keys.
 *
 * No answer carries a key: each row names the provider, the key's last
 * four characters, the endpoint it is used against (`baseUrl`, empty for
 * the provider's own API), who saved it and when, and when it last served
 * a call. A child
 * organization's list includes its parent's keys for the providers it
 * holds none of (`inheritedFromOrg`). Every member may read it
 * (`can_view_billing`).
 *
 * Cloud-only.
 *
 * @example
 * ```tsx
 * const { keys } = useProviderKeys(org);
 * ```
 */
export function useProviderKeys(org: string | null, options?: UseProviderKeysOptions): UseProviderKeysReturn {
  const stigmer = useStigmer();
  const enabled = (options?.enabled ?? true) && org !== null && org !== "";
  // An organization holds at most one key per provider, its parent's
  // merged in, so the walk is a page or two.
  const { data: keys, isLoading, error, refetch } = useFetch(
    enabled && org
      ? (): Promise<readonly ProviderKey[]> =>
          readEveryPage((pageToken) =>
            stigmer.providerkey.list(
              create(ListProviderKeysInputSchema, { org, pageSize: LIST_PAGE_MAX, pageToken }),
            ),
          )
      : null,
    [enabled, org, stigmer],
    null as readonly ProviderKey[] | null,
  );
  return useMemo(() => ({ keys, isLoading, error, refetch }), [keys, isLoading, error, refetch]);
}

/** Return value of {@link useProviderKeyActions}. */
export interface UseProviderKeyActionsReturn {
  /**
   * Save the organization's key for a provider, replacing any it holds,
   * optionally against an own endpoint (`baseUrl`: an `https` URL as the
   * provider's SDK takes it; omitted or empty for the provider's own API,
   * and always omitted for `cursor`, which the contract refuses one for).
   * The provider (or the endpoint) is asked about the key once first, and a
   * key it rejects is refused, as is an endpoint that is not `https` or not
   * on a public address. Resolves with the saved key, without its secret.
   */
  readonly setKey: (
    org: string,
    provider: ProviderKeyProvider,
    apiKey: string,
    baseUrl?: string,
  ) => Promise<ProviderKey>;
  /** Remove the organization's key for a provider. */
  readonly removeKey: (org: string, provider: ProviderKeyProvider) => Promise<ProviderKey>;
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
    (org: string, provider: ProviderKeyProvider, apiKey: string, baseUrl = "") =>
      run(() => stigmer.providerkey.set(create(SetProviderKeyInputSchema, { org, provider, apiKey, baseUrl }))),
    [run, stigmer.providerkey],
  );
  const removeKey = useCallback(
    (org: string, provider: ProviderKeyProvider) =>
      run(() => stigmer.providerkey.delete(create(DeleteProviderKeyInputSchema, { org, provider }))),
    [run, stigmer.providerkey],
  );
  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({ setKey, removeKey, isSubmitting, error, clearError }),
    [setKey, removeKey, isSubmitting, error, clearError],
  );
}
