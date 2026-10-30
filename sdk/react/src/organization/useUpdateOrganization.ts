"use client";

import { useCallback, useState } from "react";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { Organization, OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { toError } from "@stigmer/react-core/internal";

/** Return value of {@link useUpdateOrganization}. */
export interface UseUpdateOrganizationReturn {
  /**
   * Update an organization: the fields `paths` names take their values from
   * `resource`, and every other field keeps its stored value. Resolves
   * with the updated resource.
   */
  readonly update: (
    resource: Organization | MessageInitShape<typeof OrganizationSchema>,
    paths: string[],
  ) => Promise<Organization>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset the error state to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `organization.update(resource, paths)` with
 * loading and error state.
 *
 * `resource` names the organization by `metadata.id`, and `paths` names the
 * fields the update changes (proto field paths such as
 * `spec.description`). Every field it does not name keeps its stored value, so
 * a teammate's change to another field survives the save. A organization read
 * carries `metadata.etag`: sent back, the update is refused (ABORTED,
 * reason `ETAG_MISMATCH`) if the organization changed since it was read.
 *
 * An organization's policies have their own door (`updatePolicies`), and
 * its parent and external id are fixed at create: an update that names
 * them is refused.
 *
 * @example
 * ```tsx
 * const { update, isUpdating, error } = useUpdateOrganization();
 *
 * await update(
 *   {
 *     metadata: { id: organization.metadata!.id, etag: organization.metadata!.etag },
 *     spec: { description: "Updated description" },
 *   },
 *   ["spec.description"],
 * );
 * ```
 */
export function useUpdateOrganization(): UseUpdateOrganizationReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (
      resource: Organization | MessageInitShape<typeof OrganizationSchema>,
      paths: string[],
    ): Promise<Organization> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.organization.update(resource, paths);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return { update, isUpdating, error, clearError };
}
