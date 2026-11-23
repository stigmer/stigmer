"use client";

// How many versions an agent has, for the agent page's Versions tab badge.
// It reads only the history's first page: the history carries no total, so
// the count says when more follow rather than guess one. It stays in the kit
// beside the badge it serves; the history itself and how a version reads are
// `@stigmer/react-core`'s `useAgentVersions` and `agentVersionLabel`.

import { create } from "@bufbuild/protobuf";
import { ListAgentVersionsInputSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import { useStigmer } from "@stigmer/react-core";
import { useFetch } from "@stigmer/react-core/internal";

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
 * `currentVersion` (the agent's `status.versionHash`, as the caller holds
 * it) reads the count again when it changes, so a save that made a new
 * version shows in the count at once.
 */
export function useAgentVersionCount(
  org: string | null,
  slug: string | null,
  currentVersion?: string,
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
    [org, slug, stigmer, currentVersion],
    NO_VERSION_COUNT,
  );
  return data;
}
