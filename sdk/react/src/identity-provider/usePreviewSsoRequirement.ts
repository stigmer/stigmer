"use client";

import { create } from "@bufbuild/protobuf";
import {
  SsoRequirementPreviewInputSchema,
  type SsoRequirementPreview,
} from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link usePreviewSsoRequirement}. */
export interface UsePreviewSsoRequirementReturn {
  /** Who would stop counting, or `null` before the first answer. */
  readonly preview: SsoRequirementPreview | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

/**
 * Data hook for the owners' preview of a sign-in requirement: the members
 * whose account the organization's SSO provider did not sign in, each with
 * the invitations they created and the automations that act as them, and
 * the owners, who are exempt. Only the organization's owners may read it.
 *
 * Pass `null` to skip the read.
 */
export function usePreviewSsoRequirement(org: string | null): UsePreviewSsoRequirementReturn {
  const stigmer = useStigmer();
  const { data, isLoading, error, refetch } = useFetch(
    org ? () => stigmer.identityProvider.previewSsoRequirement(create(SsoRequirementPreviewInputSchema, { org })) : null,
    [org, stigmer],
    null as SsoRequirementPreview | null,
  );
  return { preview: data, isLoading, error, refetch };
}
