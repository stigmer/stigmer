"use client";

/**
 * Data hook over a conversation's Files: one list per conversation, read
 * through `stigmer.file.listAll({org, session_id})`, with the Files each turn
 * returned grouped by run id.
 *
 * Trade-offs:
 * - A turn's outputs register when the turn ends, and nothing streams them,
 *   so the list re-reads when the host says the set of ended turns changed
 *   (`settledKey`, the joined ids of the session's terminal runs). That key
 *   moves exactly when the host's runs refetch shows a turn ended, so Files
 *   follow the runs with no second trigger and no polling.
 * - A re-read keeps the previous list on screen (stale-while-revalidate);
 *   only a different conversation resets it.
 * - The server lists newest first, and both fields keep that order.
 * - A person's uploads carry no run id and are listed in `files` but never
 *   in `outputsByRun`: the outputs of a turn are only what it saved.
 */

import { useEffect, useMemo, useRef } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

const NO_FILES: readonly StigmerFile[] = [];

/** Return value of {@link useSessionFiles}. */
export interface UseSessionFilesReturn {
  /** Every File of the conversation, newest first. */
  readonly files: readonly StigmerFile[];
  /** The Files each turn returned, by run id, newest first. */
  readonly outputsByRun: ReadonlyMap<string, readonly StigmerFile[]>;
  /** True while the first read is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed read, or `null`. */
  readonly error: Error | null;
  /** Read the list again (a stopped turn's outputs arrive after its end). */
  readonly refetch: () => void;
}

/**
 * Data hook that lists a conversation's Files and groups each turn's
 * outputs by run id.
 *
 * @param org - The conversation's organization, or `null` to skip.
 * @param sessionId - The conversation's id, or `null` to skip.
 * @param settledKey - Any string that changes when a turn ends (the joined
 *   ids of the session's terminal runs); a change re-reads the list.
 *
 * @example
 * ```tsx
 * const settledKey = runs.filter(isSettled).map((r) => r.metadata?.id).join(",");
 * const { outputsByRun } = useSessionFiles(org, sessionId, settledKey);
 * ```
 */
export function useSessionFiles(
  org: string | null,
  sessionId: string | null,
  settledKey: string,
): UseSessionFilesReturn {
  const stigmer = useStigmer();
  const active = !!org && !!sessionId;
  const { data, isLoading, error, refetch } = useFetch<readonly StigmerFile[]>(
    org && sessionId
      ? async () => {
          const files: StigmerFile[] = [];
          for await (const file of stigmer.file.listAll({ org, sessionId })) {
            files.push(file);
          }
          return files;
        }
      : null,
    [org, sessionId, active, stigmer],
    NO_FILES,
    { cacheKey: active ? `session-files:${sessionId}` : undefined },
  );

  // A changed key re-reads in place; the first render's key is the mount's
  // own read, so it never doubles it.
  const lastKey = useRef(settledKey);
  useEffect(() => {
    if (lastKey.current === settledKey) return;
    lastKey.current = settledKey;
    refetch();
  }, [settledKey, refetch]);

  const outputsByRun = useMemo(() => {
    const byRun = new Map<string, StigmerFile[]>();
    for (const file of data) {
      const runId = file.status?.runId;
      if (!runId) continue;
      const list = byRun.get(runId);
      if (list) list.push(file);
      else byRun.set(runId, [file]);
    }
    return byRun as ReadonlyMap<string, readonly StigmerFile[]>;
  }, [data]);

  return useMemo(
    () => ({ files: data, outputsByRun, isLoading, error, refetch }),
    [data, outputsByRun, isLoading, error, refetch],
  );
}
