"use client";

/**
 * Data hook for an agent's flagged runs in the active organization: the
 * failed grades of the last few days (a run-health check, the AI judge, or
 * a thumbs down), newest first, read a page at a time through
 * `score.listFlaggedByAgent()`.
 *
 * Unlike the quality report, the list holds whole scores, so the server
 * returns only the runs the viewer can open. A page may hold fewer scores
 * than asked for, even none, and still carry a token: more may follow, so
 * `hasMore` follows the token, never the page's length. The first page is
 * read with `useFetch`; `loadMore` appends the pages after it, and a new
 * first page (another agent, window or organization, or a refetch) drops
 * them, so a page read for an earlier query is never shown under a later
 * one. Pinned by `__tests__/quality-hooks.test.tsx`.
 */

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  ListFlaggedScoresByAgentRequestSchema,
  type ScoreList,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { toError } from "../internal/toError.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";

/** How many flagged scores one page asks for. */
export const FLAGGED_PAGE_SIZE = 20;

/** Return value of {@link useFlaggedRuns}. */
export interface UseFlaggedRunsReturn {
  /** The flagged scores read so far, newest first. */
  readonly items: readonly Score[];
  /** `true` until the first page answers (or fails) for the current agent, window and organization. */
  readonly isLoading: boolean;
  /** Error from the first page's read, or `null` when healthy. */
  readonly error: Error | null;
  /** `true` when the server said more may follow. */
  readonly hasMore: boolean;
  /** Read the next page and append it; a no-op while one is in flight or none follows. */
  readonly loadMore: () => void;
  /** `true` while a further page is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last further page's read, or `null`. */
  readonly loadMoreError: Error | null;
  /** Read the first page again, dropping the pages after it. */
  readonly refetch: () => void;
}

/** The pages read after a first page, kept with the first page they follow. */
interface LaterPages {
  readonly after: ScoreList;
  readonly items: readonly Score[];
  readonly nextPageToken: string;
}

const NO_SCORES: readonly Score[] = [];

/**
 * Data hook that lists an agent's flagged runs in the active organization
 * over the last `days` days (1 to 90; 0 asks for 30), newest first, a page
 * of {@link FLAGGED_PAGE_SIZE} at a time.
 *
 * Pass an empty `agentId` to skip fetching, while the agent is loading.
 *
 * @example
 * ```tsx
 * const { items, hasMore, loadMore } = useFlaggedRuns(agentId, 30);
 * ```
 */
export function useFlaggedRuns(
  agentId: string,
  days: number,
): UseFlaggedRunsReturn {
  const stigmer = useStigmer();
  const org = useActiveOrgId();

  const readPage = useCallback(
    (pageToken: string): Promise<ScoreList> =>
      stigmer.score.listFlaggedByAgent(
        create(ListFlaggedScoresByAgentRequestSchema, {
          org,
          agentId,
          days,
          pageSize: FLAGGED_PAGE_SIZE,
          pageToken,
        }),
      ),
    [stigmer, org, agentId, days],
  );

  const enabled = agentId !== "" && org !== "";
  const {
    data: first,
    isLoading: fetching,
    error,
    refetch,
  } = useFetch<ScoreList | null>(
    enabled ? () => readPage("") : null,
    [org, agentId, days, stigmer],
    null,
  );
  // Loading until the first page answers: the render that enables the read
  // comes before the read starts, and must not pass for an empty list.
  const isLoading = fetching || (enabled && first === null && error === null);

  const [later, setLater] = useState<LaterPages | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [failure, setFailure] = useState<{
    readonly after: ScoreList;
    readonly error: Error;
  } | null>(null);

  // Pages read after an earlier first page do not belong to this one.
  const current = first !== null && later?.after === first ? later : null;
  const loadMoreError =
    first !== null && failure?.after === first ? failure.error : null;
  const nextPageToken =
    current !== null ? current.nextPageToken : (first?.nextPageToken ?? "");

  const loadMore = useCallback(() => {
    if (first === null || nextPageToken === "" || isLoadingMore) return;
    setIsLoadingMore(true);
    setFailure(null);
    readPage(nextPageToken).then(
      (page) => {
        setLater((previous) => ({
          after: first,
          items: [
            ...(previous?.after === first ? previous.items : NO_SCORES),
            ...page.items,
          ],
          nextPageToken: page.nextPageToken,
        }));
        setIsLoadingMore(false);
      },
      (err: unknown) => {
        setFailure({ after: first, error: toError(err) });
        setIsLoadingMore(false);
      },
    );
  }, [first, nextPageToken, isLoadingMore, readPage]);

  const items = useMemo(
    () =>
      current === null
        ? (first?.items ?? NO_SCORES)
        : [...(first?.items ?? NO_SCORES), ...current.items],
    [first, current],
  );

  return useMemo(
    () => ({
      items,
      isLoading,
      error,
      hasMore: nextPageToken !== "",
      loadMore,
      isLoadingMore,
      loadMoreError,
      refetch,
    }),
    [
      items,
      isLoading,
      error,
      nextPageToken,
      loadMore,
      isLoadingMore,
      loadMoreError,
      refetch,
    ],
  );
}
