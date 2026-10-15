"use client";

/**
 * The latest finished eval run of each agent version a view shows, read
 * for the quality report's version table.
 *
 * The agent's eval runs list pages newest first, and the eval run that
 * answers a version may sit on any page, so the hook walks the pages,
 * keeping each version's first that measures it (quality-view.ts
 * `measuresVersion`), and stops as soon as every version asked about has
 * one, or the list ends. A version with none is simply absent.
 *
 * @internal Not part of the public `@stigmer/react` API.
 */
import { create } from "@bufbuild/protobuf";
import type { EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { ListEvalRunsByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/io_pb";
import { everyEntry } from "@stigmer/sdk";
import { evalRunVersionOf } from "../eval-run/eval-view.js";
import { useStigmer } from "../hooks.js";
import { LIST_PAGE_MAX } from "../internal/everyPage.js";
import { useFetch } from "../internal/useFetch.js";
import { latestFinishedEvalByVersion, measuresVersion } from "./quality-view.js";

const NONE: ReadonlyMap<string, EvalRun> = new Map();

/**
 * @param agentId  The agent; empty asks nothing.
 * @param versions The version hashes the view shows.
 */
export function useLatestFinishedEvals(
  agentId: string,
  versions: readonly string[],
): ReadonlyMap<string, EvalRun> {
  const stigmer = useStigmer();
  const wanted = versions.join("\n");
  const { data } = useFetch(
    agentId !== "" && versions.length > 0
      ? async () => {
          const missing = new Set(versions);
          const read: EvalRun[] = [];
          for await (const evalRun of everyEntry((pageToken) =>
            stigmer.evalrun.listByAgent(
              create(ListEvalRunsByAgentRequestSchema, { agentId, pageSize: LIST_PAGE_MAX, pageToken }),
            ),
          )) {
            read.push(evalRun);
            if (measuresVersion(evalRun)) missing.delete(evalRunVersionOf(evalRun));
            if (missing.size === 0) break;
          }
          return latestFinishedEvalByVersion(read);
        }
      : null,
    [agentId, wanted, stigmer],
    NONE,
  );
  return data;
}
