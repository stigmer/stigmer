"use client";

/**
 * Behaviour hook for creating an API key that speaks for a service account
 * (`apiKey.createForServiceAccount`), with loading and error state.
 *
 * The key belongs to the service account, not to the admin who creates it:
 * it keeps working when that admin leaves, works only in the service
 * account's organization, and what it creates names the service account as
 * its creator. As with every key, the raw value is in the create response's
 * `spec.keyHash` and is never returned again, so the caller shows it once
 * (`ApiKeyCreatedAlert`).
 */
import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { CreateServiceAccountKeyInputSchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** What a service account's key is created with. */
export interface CreateServiceAccountKeyParams {
  /** The service account the key speaks for, by id. */
  readonly serviceAccountId: string;
  /** The key's name, shown beside its fingerprint (e.g. `github-actions`). */
  readonly name: string;
  /** When the key stops working. Leave unset with `neverExpires`. */
  readonly expiresAt?: Date;
  /** The key never expires. */
  readonly neverExpires?: boolean;
}

/** Return value of {@link useCreateServiceAccountKey}. */
export interface UseCreateServiceAccountKeyReturn {
  /** Create the key. Resolves with the key, its raw value in `spec.keyHash` this once. */
  readonly create: (params: CreateServiceAccountKeyParams) => Promise<ApiKey>;
  /** `true` while the request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that wraps `apiKey.createForServiceAccount()`.
 *
 * @example
 * ```tsx
 * const { create } = useCreateServiceAccountKey();
 * const key = await create({ serviceAccountId, name: "github-actions", neverExpires: true });
 * // key.spec?.keyHash is the raw key: show it once
 * ```
 */
export function useCreateServiceAccountKey(): UseCreateServiceAccountKeyReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const createKey = useCallback(
    async (params: CreateServiceAccountKeyParams): Promise<ApiKey> => {
      setIsCreating(true);
      setError(null);
      try {
        return await stigmer.apiKey.createForServiceAccount(
          create(CreateServiceAccountKeyInputSchema, {
            serviceAccountId: params.serviceAccountId,
            name: params.name,
            neverExpires: params.neverExpires === true,
            ...(params.expiresAt !== undefined && params.neverExpires !== true
              ? { expiresAt: timestampFromDate(params.expiresAt) }
              : {}),
          }),
        );
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [stigmer],
  );

  return { create: createKey, isCreating, error, clearError };
}
