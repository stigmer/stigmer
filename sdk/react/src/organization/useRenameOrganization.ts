"use client";

/**
 * useRenameOrganization: the mutation behind changing an organization's
 * slug. A slug is the renamable name; the id never changes, so nothing
 * that names the organization by id is touched by a rename.
 */
import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { RenameInputSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { toError } from "@stigmer/react-core/internal";

/** Return value of {@link useRenameOrganization}. */
export interface UseRenameOrganizationReturn {
  /**
   * Give the organization `orgId` names (an id or its current slug) the
   * new `slug`. Resolves with the renamed resource.
   */
  readonly rename: (orgId: string, slug: string) => Promise<Organization>;
  /** `true` while the rename request is in flight. */
  readonly isRenaming: boolean;
  /** Error from the last failed rename, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `organization.rename()` with loading and
 * error state.
 *
 * Renaming changes an organization's slug, the name people read and that
 * console URLs carry; its id, which every resource names it by, stays the
 * same. Links built with the old slug keep resolving for a while after the
 * rename. Only the organization's owners may rename it.
 *
 * @example
 * ```tsx
 * const { rename, isRenaming, error } = useRenameOrganization();
 *
 * const renamed = await rename(org.metadata.id, "acme-labs");
 * refresh(renamed.metadata?.id);
 * ```
 */
export function useRenameOrganization(): UseRenameOrganizationReturn {
  const stigmer = useStigmer();
  const [isRenaming, setIsRenaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const rename = useCallback(
    async (orgId: string, slug: string): Promise<Organization> => {
      setIsRenaming(true);
      setError(null);

      try {
        return await stigmer.organization.rename(
          create(RenameInputSchema, { resourceId: orgId, slug }),
        );
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsRenaming(false);
      }
    },
    [stigmer],
  );

  return { rename, isRenaming, error, clearError };
}
