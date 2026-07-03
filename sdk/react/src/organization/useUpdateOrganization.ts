"use client";

import { useCallback, useState } from "react";
import type { OrganizationInput } from "@stigmer/sdk";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpdateOrganization}. */
export interface UseUpdateOrganizationReturn {
  /** Submit an {@link OrganizationInput} to update an existing organization. Resolves with the updated resource. */
  readonly update: (input: OrganizationInput) => Promise<Organization>;
  /** `true` while the update request is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `organization.update()` with loading and
 * error state.
 *
 * Updates an existing Organization resource. The input must include
 * `name`, `org`, and `slug` to identify the target resource, along
 * with the spec fields to update (`description`, `logoUrl`).
 *
 * Returns the full {@link Organization} proto including
 * server-updated metadata (version, timestamps) so callers can
 * immediately reference the latest state.
 *
 * @example
 * ```tsx
 * const { update, isUpdating, error } = useUpdateOrganization();
 *
 * const updated = await update({
 *   name: "Acme Corp",
 *   slug: "acme-corp",
 *   org: "acme-corp",
 *   description: "Updated description",
 * });
 * refetch(); // refresh profile view
 * ```
 */
export function useUpdateOrganization(): UseUpdateOrganizationReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (input: OrganizationInput): Promise<Organization> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.organization.update(input);
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
