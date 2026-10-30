"use client";

import { useCallback, useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  ListSkillVersionsInputSchema,
  ListSkillVersionsResponseSchema,
  type SkillVersionEntry as ProtoSkillVersionEntry,
} from "@stigmer/apis/ai/stigmer/agentic/skill/v1/io_pb";
import { useStigmer } from "@stigmer/react-core";
import { isUnimplemented } from "../internal/isUnimplemented.js";
import { useCursorPages } from "@stigmer/react-core/internal";
import type { VersionEntry } from "../version-history/types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Return value of {@link useSkillVersions}. */
export interface UseSkillVersionsReturn {
  /** Version entries mapped to the generic timeline format (newest first). */
  readonly versions: readonly VersionEntry[];
  /** `true` when no versions are available (RPC unimplemented or empty response). */
  readonly isEmpty: boolean;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request (excludes UNIMPLEMENTED), or `null`. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
  /**
   * Look up the artifact storage key for a version by its hash.
   * Used by diff flows to fetch historical artifacts via `getArtifact()`.
   * Returns `null` if the version hash is not found or has no artifact key.
   */
  readonly getArtifactKey: (versionHash: string) => string | null;
  /** `true` while the server holds entries beyond those loaded. */
  readonly hasMore: boolean;
  /** Load the next page. No-op while one is loading or when nothing follows. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` read is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. */
  readonly loadMoreError: Error | null;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

/** The answer of a server that keeps no skill history: no versions. */
const NO_VERSIONS = create(ListSkillVersionsResponseSchema);

/**
 * Data hook that fetches version history for a skill.
 *
 * Calls the `listVersions` RPC via the SDK client and maps the response
 * to generic {@link VersionEntry} objects for the `VersionTimeline`
 * component.
 *
 * **Graceful degradation**: If the backend returns UNIMPLEMENTED (the
 * RPC handler hasn't been deployed yet), the hook treats it as an empty
 * response — `versions` is `[]` and `isEmpty` is `true`. No error is
 * surfaced to the consumer. This enables the frontend to ship ahead of
 * the backend without visual breakage.
 *
 * Pass `null` for `org` or `slug` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { versions, isEmpty, isLoading } = useSkillVersions("acme", "code-style-guide");
 *
 * if (!isEmpty) {
 *   return <VersionTimeline entries={versions} />;
 * }
 * ```
 */
export function useSkillVersions(
  org: string | null,
  slug: string | null,
): UseSkillVersionsReturn {
  const stigmer = useStigmer();

  const pages = useCursorPages<ProtoSkillVersionEntry>(
    org && slug
      ? async (pageToken) => {
          try {
            const request = create(ListSkillVersionsInputSchema, {
              org,
              slug,
              pageToken,
            });
            return await stigmer.skill.listVersions(request);
          } catch (err) {
            if (isUnimplemented(err)) return NO_VERSIONS;
            throw err;
          }
        }
      : null,
    [org, slug, stigmer],
    (entry) => entry.versionHash,
  );
  const rawVersions = pages.items;
  const { hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch } = pages;

  const versions = useMemo(
    () => rawVersions.map(mapProtoToVersionEntry),
    [rawVersions],
  );

  const artifactKeyMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of rawVersions) {
      if (entry.versionHash && entry.artifactStorageKey) {
        map.set(entry.versionHash, entry.artifactStorageKey);
      }
    }
    return map;
  }, [rawVersions]);

  const getArtifactKey = useCallback(
    (versionHash: string): string | null =>
      artifactKeyMap.get(versionHash) ?? null,
    [artifactKeyMap],
  );

  const isEmpty = versions.length === 0;

  return useMemo(
    () => ({
      versions,
      isEmpty,
      hasMore,
      loadMore,
      isLoadingMore,
      loadMoreError,
      isLoading,
      error,
      refetch,
      getArtifactKey,
    }),
    [versions, isEmpty, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch, getArtifactKey],
  );
}

// ---------------------------------------------------------------------------
// Proto → generic mapping
// ---------------------------------------------------------------------------

function mapProtoToVersionEntry(proto: ProtoSkillVersionEntry): VersionEntry {
  return {
    id: proto.versionHash,
    timestamp: proto.pushedAt ? timestampDate(proto.pushedAt) : new Date(0),
    actor: proto.pushedBy
      ? {
          id: proto.pushedBy.id,
          avatar: proto.pushedBy.avatar || undefined,
          displayName: undefined,
        }
      : undefined,
    label: proto.versionHash.slice(0, 12),
    sublabel: proto.message || undefined,
    isCurrent: proto.isCurrent,
    tag: proto.tag || undefined,
    gitProvenance: proto.gitProvenance
      ? {
          remoteUrl: proto.gitProvenance.remoteUrl,
          ref: proto.gitProvenance.ref,
          commit: proto.gitProvenance.commit,
        }
      : undefined,
  };
}

