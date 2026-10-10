"use client";

/**
 * Mutation hook over `organization.updatePolicies()`, the one way to change
 * what an organization lets its members do: update and apply keep the
 * stored policies, so a policy is changed only here.
 */
import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { UpdateOrganizationPoliciesInputSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { OrganizationPoliciesSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/spec_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Every policy an organization holds, as it should stand after the save. */
export interface OrganizationPoliciesValue {
  /** Members may create agents; when `false`, only admins do. */
  readonly membersCanCreateAgents: boolean;
}

/** Return value of {@link useUpdateOrganizationPolicies}. */
export interface UseUpdateOrganizationPoliciesReturn {
  /**
   * Replace every policy of the organization (by id or slug) with
   * `policies`. Resolves with the updated organization.
   */
  readonly updatePolicies: (
    org: string,
    policies: OrganizationPoliciesValue,
  ) => Promise<Organization>;
  /** `true` while the request is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed save, or `null`. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Changes an organization's policies. The caller passes every policy: a
 * policy left out of the message turns off, so a caller that edits one
 * spreads the stored ones first (see {@link organizationPoliciesOf}).
 *
 * @example
 * ```tsx
 * const { updatePolicies, isUpdating } = useUpdateOrganizationPolicies();
 * await updatePolicies(orgId, { ...organizationPoliciesOf(org), membersCanCreateAgents: false });
 * ```
 */
export function useUpdateOrganizationPolicies(): UseUpdateOrganizationPoliciesReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const updatePolicies = useCallback(
    async (org: string, policies: OrganizationPoliciesValue): Promise<Organization> => {
      setIsUpdating(true);
      setError(null);
      try {
        return await stigmer.organization.updatePolicies(
          create(UpdateOrganizationPoliciesInputSchema, {
            orgId: org,
            policies: create(OrganizationPoliciesSchema, {
              membersCanCreateAgents: policies.membersCanCreateAgents,
            }),
          }),
        );
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return { updatePolicies, isUpdating, error, clearError };
}

/**
 * An organization's policies as they stand. An organization that stores no
 * policies holds the defaults: members may create agents.
 */
export function organizationPoliciesOf(
  organization: Organization | null | undefined,
): OrganizationPoliciesValue {
  const policies = organization?.spec?.policies;
  return {
    membersCanCreateAgents: policies === undefined ? true : policies.membersCanCreateAgents,
  };
}
