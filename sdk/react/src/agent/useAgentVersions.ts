"use client";

import { useCallback, useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import {
  ListAgentVersionsInputSchema,
  type AgentVersionEntry as ProtoAgentVersionEntry,
} from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import { useStigmer } from "../hooks.js";
import { useCursorPages } from "../internal/useCursorPages.js";
import { useFetch } from "../internal/useFetch.js";
import type { VersionEntry } from "../version-history/types.js";

/** Return value of {@link useAgentVersions}. */
export interface UseAgentVersionsReturn {
  /** Version entries mapped to the generic timeline format (newest first). */
  readonly versions: readonly VersionEntry[];
  /** `true` when the agent has no recorded version yet. */
  readonly isEmpty: boolean;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null`. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
  /**
   * The spec a version stored, by its hash: what a turn recorded on that
   * version runs. `null` for a hash the loaded pages do not hold.
   */
  readonly getSpec: (versionHash: string) => AgentSpec | null;
  /** `true` while the server holds entries beyond those loaded. */
  readonly hasMore: boolean;
  /** Load the next page. No-op while one is loading or when nothing follows. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` read is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. */
  readonly loadMoreError: Error | null;
}

/**
 * Data hook that fetches an agent's version history.
 *
 * Every apply that changes an agent records a version under its content
 * hash; this hook pages the `listVersions` RPC (newest first, `hasMore` /
 * `loadMore` for older ones) and maps each entry to the
 * generic {@link VersionEntry} the shared `VersionTimeline` renders, keeping
 * each version's full spec for {@link UseAgentVersionsReturn.getSpec}.
 *
 * An agent last written before agents were versioned has no history until
 * its next apply: `versions` is empty and `isEmpty` is `true`.
 *
 * Pass `null` for `org` or `slug` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { versions, isEmpty } = useAgentVersions("acme", "pr-reviewer");
 *
 * if (!isEmpty) {
 *   return <VersionTimeline entries={versions} />;
 * }
 * ```
 */
export function useAgentVersions(
  org: string | null,
  slug: string | null,
): UseAgentVersionsReturn {
  const stigmer = useStigmer();

  const pages = useCursorPages<ProtoAgentVersionEntry>(
    org && slug
      ? (pageToken) =>
          stigmer.agent.listVersions(
            create(ListAgentVersionsInputSchema, { org, slug, pageToken }),
          )
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

  const specByHash = useMemo(() => {
    const map = new Map<string, AgentSpec>();
    for (const entry of rawVersions) {
      if (entry.versionHash !== "" && entry.specSnapshot !== undefined) {
        map.set(entry.versionHash, entry.specSnapshot);
      }
    }
    return map;
  }, [rawVersions]);

  const getSpec = useCallback(
    (versionHash: string): AgentSpec | null =>
      specByHash.get(versionHash) ?? null,
    [specByHash],
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
      getSpec,
    }),
    [versions, isEmpty, hasMore, loadMore, isLoadingMore, loadMoreError, isLoading, error, refetch, getSpec],
  );
}

/** How many versions an agent has, as far as a count of them reaches. */
export interface AgentVersionCount {
  /** The versions on the history's first page; `0` while loading. */
  readonly count: number;
  /**
   * `true` when more versions follow the first page: the history carries
   * no total, so a badge reads "50+" rather than a number it cannot know.
   */
  readonly isLowerBound: boolean;
}

const NO_VERSION_COUNT: AgentVersionCount = { count: 0, isLowerBound: false };

/**
 * How many versions an agent has, for a count (a tab badge): the length of
 * the history's first page, and whether more follow. `0` while loading,
 * for an agent with no version yet, and when `org` or `slug` is `null`.
 */
export function useAgentVersionCount(
  org: string | null,
  slug: string | null,
): AgentVersionCount {
  const stigmer = useStigmer();
  const { data } = useFetch(
    org && slug
      ? async (): Promise<AgentVersionCount> => {
          const response = await stigmer.agent.listVersions(
            create(ListAgentVersionsInputSchema, { org, slug }),
          );
          return {
            count: response.entries.length,
            isLowerBound: response.nextPageToken !== "",
          };
        }
      : null,
    [org, slug, stigmer],
    NO_VERSION_COUNT,
  );
  return data;
}

/** How many hex characters of a version hash a label shows. */
const SHORT_HASH_LENGTH = 12;

/**
 * How a version reads to a person: its tag when it has one, else the
 * short hash the Versions tab shows. `versions` is the agent's history as
 * {@link useAgentVersions} returns it; a hash it does not hold (still
 * loading, or a history the viewer cannot read) reads as its short hash.
 *
 * @example
 * ```tsx
 * const { versions } = useAgentVersions(org, slug);
 * agentVersionLabel(versions, run.status?.agentVersionHash ?? ""); // "v2" or "3f2a9c1e0b7d"
 * ```
 */
export function agentVersionLabel(
  versions: readonly VersionEntry[],
  versionHash: string,
): string {
  const entry = versions.find((v) => v.id === versionHash);
  return entry?.tag ?? versionHash.slice(0, SHORT_HASH_LENGTH);
}

function mapProtoToVersionEntry(proto: ProtoAgentVersionEntry): VersionEntry {
  return {
    id: proto.versionHash,
    timestamp: proto.appliedAt ? timestampDate(proto.appliedAt) : new Date(0),
    actor: proto.appliedBy
      ? {
          id: proto.appliedBy.id,
          avatar: proto.appliedBy.avatar || undefined,
          displayName: undefined,
        }
      : undefined,
    label: proto.versionHash.slice(0, SHORT_HASH_LENGTH),
    sublabel: proto.message || undefined,
    isCurrent: proto.isCurrent,
    tag: proto.tag || undefined,
  };
}
