"use client";

/**
 * useRenameResource: the mutation behind changing a resource's slug, for
 * every kind with a rename RPC but the organization (useRenameOrganization
 * keeps that one). The id never changes, so everything that names the
 * resource by id keeps working; its old slug leads to it for reading for
 * 30 days, and a file that still names the old slug is refused until it
 * names the new one.
 */
import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import { RenameInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { RenameInput } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/**
 * Resource kinds a person may rename (beside the organization), by the
 * kind's enum name: the name a permission check takes.
 */
export type RenamableResourceKind =
  | "agent"
  | "vault"
  | "schedule"
  | "channel_app"
  | "oauth_app"
  | "platform_client"
  | "team"
  | "identity_provider";

/** The resource a rename answers: its id and slug, as every kind's metadata holds them. */
export type RenamedResource = Message & {
  readonly metadata?: { readonly id: string; readonly slug: string };
};

/** Return value of {@link useRenameResource}. */
export interface UseRenameResourceReturn {
  /**
   * Give the resource `resourceId` names the new `slug`. Resolves with the
   * renamed resource; rejects with the server's refusal (a taken or
   * recently held slug, a caller who may not delete the resource).
   */
  readonly rename: (
    resourceId: string,
    slug: string,
  ) => Promise<RenamedResource>;
  /** `true` while the rename request is in flight. */
  readonly isRenaming: boolean;
  /** Error from the last failed rename, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps the kind's `rename()` with loading and error
 * state. Whoever may delete a resource may rename it.
 *
 * @example
 * ```tsx
 * const { rename, isRenaming, error } = useRenameResource("agent");
 *
 * const renamed = await rename(agent.metadata.id, "support-bot");
 * canonicalSlug(renamed.metadata?.slug ?? "");
 * ```
 */
export function useRenameResource(
  kind: RenamableResourceKind,
): UseRenameResourceReturn {
  const stigmer = useStigmer();
  const [isRenaming, setIsRenaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const rename = useCallback(
    async (resourceId: string, slug: string): Promise<RenamedResource> => {
      setIsRenaming(true);
      setError(null);
      const input = create(RenameInputSchema, { resourceId, slug });
      try {
        return await renameOf(stigmer, kind, input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsRenaming(false);
      }
    },
    [stigmer, kind],
  );

  return useMemo(
    () => ({ rename, isRenaming, error, clearError }),
    [rename, isRenaming, error, clearError],
  );
}

function renameOf(
  stigmer: ReturnType<typeof useStigmer>,
  kind: RenamableResourceKind,
  input: RenameInput,
): Promise<RenamedResource> {
  switch (kind) {
    case "agent":
      return stigmer.agent.rename(input);
    case "vault":
      return stigmer.vault.rename(input);
    case "schedule":
      return stigmer.schedule.rename(input);
    case "channel_app":
      return stigmer.channelapp.rename(input);
    case "oauth_app":
      return stigmer.oauthapp.rename(input);
    case "platform_client":
      return stigmer.platformclient.rename(input);
    case "team":
      return stigmer.team.rename(input);
    case "identity_provider":
      return stigmer.identityProvider.rename(input);
  }
}
