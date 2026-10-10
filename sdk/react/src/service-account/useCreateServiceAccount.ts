"use client";

/**
 * Behaviour hook for creating an organization's service account
 * (`identityAccount.createServiceAccount`), with loading and error state.
 *
 * The server creates the account and grants it the one organization role it
 * holds in the same call, so the hook takes the role with the name. The role
 * is admin, member or viewer; the server refuses owner, and a server running
 * without sign-in refuses the call, since no key could authenticate there.
 */
import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { CreateServiceAccountInputSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/io_pb";
import type { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** What a service account is created with. */
export interface CreateServiceAccountParams {
  /** The organization it belongs to for its whole life, by id or slug. */
  readonly org: string;
  /** Its name, unique among the organization's service accounts (e.g. `ci-deploy`). */
  readonly name: string;
  /** The organization role it holds: admin, member or viewer. */
  readonly role: IamRole;
}

/** Return value of {@link useCreateServiceAccount}. */
export interface UseCreateServiceAccountReturn {
  /** Create the service account. Resolves with the created account. */
  readonly create: (params: CreateServiceAccountParams) => Promise<IdentityAccount>;
  /** `true` while the request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that wraps `identityAccount.createServiceAccount()`.
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreateServiceAccount();
 * const account = await create({ org, name: "ci-deploy", role: IamRole.member });
 * ```
 */
export function useCreateServiceAccount(): UseCreateServiceAccountReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const createAccount = useCallback(
    async (params: CreateServiceAccountParams): Promise<IdentityAccount> => {
      setIsCreating(true);
      setError(null);
      try {
        return await stigmer.identityAccount.createServiceAccount(
          create(CreateServiceAccountInputSchema, {
            org: params.org,
            name: params.name,
            role: params.role,
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

  return { create: createAccount, isCreating, error, clearError };
}
