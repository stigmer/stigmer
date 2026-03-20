"use client";

import { useCallback, useState } from "react";
import type { OrganizationInput } from "@stigmer/sdk";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

export interface UseCreateOrganizationReturn {
  readonly create: (input: OrganizationInput) => Promise<Organization>;
  readonly isCreating: boolean;
  readonly error: Error | null;
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `organization.create()` with loading/error
 * state.
 *
 * Creates an Organization resource — a tenancy boundary that owns
 * agents, environments, skills, MCP servers, and other platform
 * resources. The caller provides an {@link OrganizationInput} with
 * `name`, `org`, and optionally `description` and `logoUrl`.
 *
 * Returns the full {@link Organization} proto including
 * server-generated metadata (id, slug, version, timestamps) so
 * callers can immediately reference the created resource.
 *
 * @example
 * ```tsx
 * const { create, isCreating, error } = useCreateOrganization();
 *
 * const org = await create({
 *   name: "Acme Corp",
 *   org: "acme-corp",
 *   description: "Main engineering organization",
 * });
 * ```
 */
export function useCreateOrganization(): UseCreateOrganizationReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: OrganizationInput): Promise<Organization> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.organization.create(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [stigmer],
  );

  return { create, isCreating, error, clearError };
}
