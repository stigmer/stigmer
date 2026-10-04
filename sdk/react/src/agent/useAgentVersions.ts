"use client";

import { useCallback, useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import {
  ListAgentVersionsInputSchema,
  type AgentVersionEntry as ProtoAgentVersionEntry,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import { useStigmer } from "../hooks.js";
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
   * version runs. `null` for a hash the history does not hold.
   */
  readonly getSpec: (versionHash: string) => AgentSpec | null;
}

/**
 * Data hook that fetches an agent's version history.
 *
 * Every apply that changes an agent records a version under its content
 * hash; this hook calls the `listVersions` RPC and maps each entry to the
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

  const {
    data: rawVersions,
    isLoading,
    error,
    refetch,
  } = useFetch(
    org && slug
      ? async () => {
          const response = await stigmer.agent.listVersions(
            create(ListAgentVersionsInputSchema, { org, slug }),
          );
          return response.versions;
        }
      : null,
    [org, slug, stigmer],
    [] as ProtoAgentVersionEntry[],
  );

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
    () => ({ versions, isEmpty, isLoading, error, refetch, getSpec }),
    [versions, isEmpty, isLoading, error, refetch, getSpec],
  );
}

/**
 * How many versions an agent has, read as one entry and the history's total
 * so a count (a tab badge) never loads the history's specs. `0` while
 * loading, for an agent with no version yet, and when `org` or `slug` is
 * `null`.
 */
export function useAgentVersionCount(
  org: string | null,
  slug: string | null,
): number {
  const stigmer = useStigmer();
  const { data } = useFetch(
    org && slug
      ? async () => {
          const response = await stigmer.agent.listVersions(
            create(ListAgentVersionsInputSchema, { org, slug, pageSize: 1 }),
          );
          return response.totalCount;
        }
      : null,
    [org, slug, stigmer],
    0,
  );
  return data;
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
    label: proto.versionHash.slice(0, 12),
    sublabel: proto.message || undefined,
    isCurrent: proto.isCurrent,
    tag: proto.tag || undefined,
  };
}
