"use client";

/**
 * Data hook over a conversation's Files: one list per conversation, read
 * through `stigmer.file.listAll({org, session_id})`, with the Files each turn
 * returned grouped by run id.
 *
 * Trade-offs:
 * - Files join a conversation at two moments, and nothing streams either:
 *   the Files sent with a message become the conversation's when its turn
 *   starts, and a turn's outputs register when it ends. So the list re-reads
 *   when the host says a turn started or ended (`refreshKey`, each run's id
 *   with whether it has ended). That key moves exactly when the host's runs
 *   refetch shows either, so Files follow the runs with no second trigger,
 *   no callback threaded through the send path, and no polling.
 * - A re-read keeps the previous list on screen (stale-while-revalidate);
 *   only a different conversation resets it.
 * - The server lists newest first, and both fields keep that order.
 * - A person's uploads carry no run id and are listed in `files` but never
 *   in `outputsByRun`: the outputs of a turn are only what it saved.
 * - The key's rule is one function, `sessionFilesRefreshKey`, which every
 *   caller passes its runs through, so a host cannot build a key that
 *   misses a turn's end (a run count does: it moves when a turn starts and
 *   not when it ends, so that turn's outputs never appear).
 */

import { useEffect, useMemo, useRef } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { isTerminalPhase } from "../run/run-phases.js";
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
 * @param refreshKey - A string that changes when a turn starts or ends:
 *   {@link sessionFilesRefreshKey} of the conversation's runs. A change
 *   re-reads the list.
 *
 * @example
 * ```tsx
 * function TurnsWithFiles({ org, sessionId }: { org: string; sessionId: string }) {
 *   const conversation = useSessionConversation(sessionId, org);
 *   // Re-read as each turn starts and ends, so the files it made appear.
 *   const { outputsByRun } = useSessionFiles(org, sessionId, sessionFilesRefreshKey(conversation.runs));
 *   return <p>{outputsByRun.size} turns made files</p>;
 * }
 * ```
 */
export function useSessionFiles(
  org: string | null,
  sessionId: string | null,
  refreshKey: string,
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
  const lastKey = useRef(refreshKey);
  useEffect(() => {
    if (lastKey.current === refreshKey) return;
    lastKey.current = refreshKey;
    refetch();
  }, [refreshKey, refetch]);

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

/**
 * The `refreshKey` {@link useSessionFiles} re-reads on: each run's id with
 * whether it has ended, so the key moves when a turn starts (the Files sent
 * with its message join the conversation) and when it ends (its outputs
 * register), and at no other time.
 *
 * @param runs - The conversation's runs (`useSessionConversation().runs`).
 *
 * @example
 * ```tsx
 * function FileCount({ org, sessionId }: { org: string; sessionId: string }) {
 *   const conversation = useSessionConversation(sessionId, org);
 *   const { files } = useSessionFiles(org, sessionId, sessionFilesRefreshKey(conversation.runs));
 *   return <p>{files.length} files</p>;
 * }
 * ```
 */
export function sessionFilesRefreshKey(runs: readonly Run[]): string {
  return runs
    .map((run) => {
      const ended = isTerminalPhase(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED);
      return `${run.metadata?.id ?? ""}:${ended ? "ended" : "started"}`;
    })
    .join(",");
}
