"use client";

/**
 * Mutation hook over `organization.updateEmbedding()`, the one way to change
 * how people sign in to an organization from its own product: update and
 * apply keep the stored settings, so they are changed only here.
 */
import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { ResourceRef } from "@stigmer/client";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { UpdateOrganizationEmbeddingInputSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/io_pb";
import { OrganizationEmbeddingSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/spec_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** An organization's embedding settings, as they should stand after the save. */
export interface OrganizationEmbeddingValue {
  /** Web origins whose pages may use the minted tokens; empty allows every origin. */
  readonly allowedOrigins: readonly string[];
  /** A first sign-in creates the person's account; when `false`, the account must exist. */
  readonly createAccountsOnSignIn: boolean;
  /** The role a created account receives; unspecified grants nothing. Never owner. */
  readonly signInRole: IamRole;
  /** Shared vaults whose keys the runs of people signed in this way use, in order. */
  readonly vaults: readonly ResourceRef[];
}

/** Return value of {@link useUpdateOrganizationEmbedding}. */
export interface UseUpdateOrganizationEmbeddingReturn {
  /**
   * Replace the organization's embedding settings (by id or slug) with
   * `embedding`. Resolves with the updated organization.
   */
  readonly updateEmbedding: (
    org: string,
    embedding: OrganizationEmbeddingValue,
  ) => Promise<Organization>;
  /** `true` while the request is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed save, or `null`. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Changes an organization's embedding settings. The message is replaced
 * whole, so the caller passes every setting; a role is sent only with
 * account creation, which the contract requires.
 *
 * @example
 * ```tsx
 * const { updateEmbedding, isUpdating } = useUpdateOrganizationEmbedding();
 * await updateEmbedding(orgId, { ...organizationEmbeddingOf(org), allowedOrigins: ["https://app.example"] });
 * ```
 */
export function useUpdateOrganizationEmbedding(): UseUpdateOrganizationEmbeddingReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const updateEmbedding = useCallback(
    async (org: string, embedding: OrganizationEmbeddingValue): Promise<Organization> => {
      setIsUpdating(true);
      setError(null);
      try {
        return await stigmer.organization.updateEmbedding(
          create(UpdateOrganizationEmbeddingInputSchema, {
            orgId: org,
            embedding: create(OrganizationEmbeddingSchema, {
              allowedOrigins: [...embedding.allowedOrigins],
              createAccountsOnSignIn: embedding.createAccountsOnSignIn,
              signInRole: embedding.createAccountsOnSignIn
                ? embedding.signInRole
                : IamRole.iam_role_unspecified,
              vaults: embedding.vaults.map((ref) => ({
                kind: ApiResourceKind.vault,
                org: ref.org ?? "",
                slug: ref.slug,
                id: ref.id ?? "",
                version: ref.version ?? "",
              })),
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

  return { updateEmbedding, isUpdating, error, clearError };
}

/**
 * An organization's embedding settings as they stand. An organization that
 * stores none creates no accounts, grants nothing and allows every origin.
 */
export function organizationEmbeddingOf(
  organization: Organization | null | undefined,
): OrganizationEmbeddingValue {
  const embedding = organization?.spec?.embedding;
  return {
    allowedOrigins: [...(embedding?.allowedOrigins ?? [])],
    createAccountsOnSignIn: embedding?.createAccountsOnSignIn ?? false,
    signInRole: embedding?.signInRole ?? IamRole.iam_role_unspecified,
    vaults: (embedding?.vaults ?? []).map((ref) => ({
      org: ref.org,
      slug: ref.slug,
      ...(ref.id ? { id: ref.id } : {}),
      ...(ref.version ? { version: ref.version } : {}),
    })),
  };
}
